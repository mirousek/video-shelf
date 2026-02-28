from __future__ import annotations

import json
import logging
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.config import settings
from app.models.schemas import (
    Job,
    JobCreate,
    JobResponse,
    JobStatus,
    UploadResponse,
)
from app.services import jobstore, storage, video
from app.workers.tasks import process_video

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_video(file: UploadFile):
    """Upload a video or image file and get back a video_id + metadata."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    all_allowed = settings.allowed_extensions | settings.allowed_image_extensions
    if ext not in all_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Allowed: {all_allowed}",
        )

    video_id = storage.generate_video_id(file.filename)
    upload_path = storage.get_upload_path(video_id)

    with open(upload_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    is_image = ext in settings.allowed_image_extensions

    try:
        info = video.probe_image(upload_path) if is_image else video.probe(upload_path)
    except ValueError as e:
        storage.cleanup_local(upload_path)
        raise HTTPException(status_code=400, detail=str(e))

    if not is_image and video.needs_preview(upload_path):
        preview_path = storage.get_preview_path(video_id)
        logger.info("Transcoding preview for %s (codec: %s)", video_id, info.codec)
        video.create_preview(upload_path, preview_path)

    if settings.use_s3:
        s3_key = f"uploads/{video_id}"
        storage.upload_to_s3(upload_path, s3_key)

    return UploadResponse(video_id=video_id, info=info)


@router.post("/jobs", response_model=JobResponse)
async def create_job(request: JobCreate):
    """Create a video processing job from clips across one or more videos."""
    if request.output_format not in settings.allowed_output_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported output format. Allowed: {settings.allowed_output_formats}",
        )

    for clip in request.clips:
        upload_path = storage.get_upload_path(clip.video_id)
        if not upload_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Video {clip.video_id} not found. Upload it first.",
            )
        if clip.start >= clip.end:
            raise HTTPException(status_code=400, detail="Clip start must be before end")
        if clip.photo_duration is None:
            info = video.probe(upload_path)
            if clip.end > info.duration:
                raise HTTPException(
                    status_code=400,
                    detail=f"Clip end ({clip.end}s) exceeds duration ({info.duration}s) of {clip.video_id}",
                )

    job = Job(
        clips=request.clips,
        output_format=request.output_format,
        concat=request.concat,
        crf=request.crf,
        preset=request.preset,
    )
    jobstore.save_job(job)

    process_video.delay(job.id)

    return JobResponse(
        id=job.id,
        status=job.status,
        progress=job.progress,
        output_files=job.output_files,
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Get the current status of a processing job."""
    job = jobstore.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(
        id=job.id,
        status=job.status,
        progress=job.progress,
        output_files=job.output_files,
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("/download/{job_id}/{file_index}")
async def download_file(job_id: str, file_index: int):
    """Download a processed output file."""
    job = jobstore.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Job not completed yet")
    if file_index >= len(job.output_files):
        raise HTTPException(status_code=404, detail="File index out of range")

    file_ref = job.output_files[file_index]

    if settings.use_s3:
        url = storage.generate_presigned_url(file_ref)
        return {"download_url": url}

    path = Path(file_ref)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Output file not found on disk")
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")


MIME_MAP = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
}

IMAGE_MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


@router.get("/videos/{video_id}/stream")
async def stream_video(video_id: str):
    """Serve the video/image for browser playback. Uses a transcoded preview if the original codec is unsupported."""
    upload_path = storage.get_upload_path(video_id)
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    ext = Path(video_id).suffix.lower()

    if ext in IMAGE_MIME_MAP:
        return FileResponse(upload_path, media_type=IMAGE_MIME_MAP[ext])

    preview_path = storage.get_preview_path(video_id)
    if preview_path.exists():
        return FileResponse(preview_path, media_type="video/mp4")

    media_type = MIME_MAP.get(ext, "application/octet-stream")
    return FileResponse(upload_path, media_type=media_type)


@router.get("/videos/{video_id}/info")
async def get_video_info(video_id: str):
    """Get metadata for an uploaded video."""
    upload_path = storage.get_upload_path(video_id)
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return video.probe(upload_path)


@router.get("/videos/{video_id}/thumbnail")
async def get_thumbnail(video_id: str, t: float = 1.0):
    """Generate and return a thumbnail at the given timestamp."""
    upload_path = storage.get_upload_path(video_id)
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    thumb_path = settings.output_dir / f"thumb_{video_id}.jpg"
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    video.generate_thumbnail(upload_path, thumb_path, timestamp=t)
    return FileResponse(thumb_path, media_type="image/jpeg")


@router.websocket("/ws/jobs/{job_id}/progress")
async def job_progress_ws(websocket: WebSocket, job_id: str):
    """WebSocket endpoint for real-time progress updates on a job."""
    await websocket.accept()

    job = jobstore.get_job(job_id)
    if job is None:
        await websocket.send_json({"error": "Job not found"})
        await websocket.close()
        return

    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
        await websocket.send_json({"status": job.status, "progress": job.progress})
        await websocket.close()
        return

    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    channel = f"videoshelf:progress:{job_id}"

    try:
        await pubsub.subscribe(channel)

        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                data = json.loads(message["data"])
                await websocket.send_json(data)
                if data.get("progress", 0) >= 1.0:
                    break

            job = jobstore.get_job(job_id)
            if job and job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                await websocket.send_json({"status": job.status, "progress": job.progress})
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected from progress WS for job %s", job_id)
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await r.close()
