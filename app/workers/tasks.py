from __future__ import annotations

import logging
from pathlib import Path

from app.config import settings
from app.models.schemas import CutSegment, JobStatus
from app.services import jobstore, storage, video
from app.workers.celery_app import celery

logger = logging.getLogger(__name__)


def _resolve_target_params(clips_info: list[video.VideoInfo]) -> tuple[int, int, float]:
    """Pick the largest resolution and highest fps across all source clips."""
    width = max(i.width for i in clips_info)
    height = max(i.height for i in clips_info)
    fps = max(i.fps for i in clips_info)
    # Ensure even dimensions (required by libx264)
    width += width % 2
    height += height % 2
    return width, height, fps


@celery.task(bind=True, name="videoshelf.process_video")
def process_video(self, job_id: str) -> dict:
    """Cut clips from one or more source videos and optionally concatenate them."""
    job = jobstore.get_job(job_id)
    if job is None:
        raise ValueError(f"Job {job_id} not found")

    jobstore.update_job_status(job_id, JobStatus.PROCESSING, progress=0.0)

    for clip in job.clips:
        path = storage.get_upload_path(clip.video_id)
        if not path.exists():
            msg = f"Source video not found: {clip.video_id}"
            jobstore.update_job_status(job_id, JobStatus.FAILED, error=msg)
            return {"status": "failed", "error": msg}

    try:
        # Detect whether clips come from different sources or include images (need normalization)
        source_ids = {c.video_id for c in job.clips}
        has_images = any(c.photo_duration is not None for c in job.clips)
        needs_normalize = (len(source_ids) > 1 or has_images) and job.concat

        target_w, target_h, target_fps = 0, 0, 0.0
        if needs_normalize:
            video_source_ids = {
                c.video_id for c in job.clips if c.photo_duration is None
            }
            infos: list[video.VideoInfo] = []
            for vid in video_source_ids:
                infos.append(video.probe(storage.get_upload_path(vid)))
            for clip in job.clips:
                if clip.photo_duration is not None:
                    infos.append(video.probe_image(storage.get_upload_path(clip.video_id)))
            target_w, target_h, target_fps = _resolve_target_params(infos)
            if target_fps == 0:
                target_fps = 30.0
            logger.info(
                "Normalizing clips to %dx%d @ %.2ffps", target_w, target_h, target_fps
            )

        clip_paths: list[Path] = []
        total = len(job.clips)

        for i, clip in enumerate(job.clips):
            input_path = storage.get_upload_path(clip.video_id)
            output_path = storage.get_output_path(job_id, i, job.output_format)

            if clip.photo_duration is not None:
                w = target_w if needs_normalize else 1920
                h = target_h if needs_normalize else 1080
                fps = target_fps if needs_normalize else 30.0
                video.image_to_video(
                    input_path, output_path,
                    duration=clip.photo_duration,
                    width=w, height=h, fps=fps,
                    output_format=job.output_format,
                    crf=job.crf, preset=job.preset,
                )
            else:
                seg = CutSegment(start=clip.start, end=clip.end)
                if needs_normalize:
                    video.cut_segment_normalized(
                        input_path, seg, output_path,
                        width=target_w, height=target_h, fps=target_fps,
                        output_format=job.output_format,
                        crf=job.crf, preset=job.preset,
                    )
                else:
                    video.cut_segment(
                        input_path, seg, output_path, job.output_format,
                        crf=job.crf, preset=job.preset,
                    )

            clip_paths.append(output_path)

            progress = (i + 1) / total
            if job.concat:
                progress *= 0.8
            jobstore.update_job_status(job_id, JobStatus.PROCESSING, progress=progress)

        output_files: list[str] = []

        if job.concat and len(clip_paths) > 1:
            final_path = storage.get_concat_output_path(job_id, job.output_format)
            video.concat_segments(clip_paths, final_path, job.output_format, crf=job.crf, preset=job.preset)

            if settings.use_s3:
                s3_key = f"outputs/{final_path.name}"
                storage.upload_to_s3(final_path, s3_key)
                output_files.append(s3_key)
            else:
                output_files.append(str(final_path))

            for p in clip_paths:
                storage.cleanup_local(p)
        else:
            for p in clip_paths:
                if settings.use_s3:
                    s3_key = f"outputs/{p.name}"
                    storage.upload_to_s3(p, s3_key)
                    output_files.append(s3_key)
                else:
                    output_files.append(str(p))

        jobstore.update_job_status(
            job_id,
            JobStatus.COMPLETED,
            progress=1.0,
            output_files=output_files,
        )
        return {"status": "completed", "output_files": output_files}

    except Exception as e:
        logger.exception("Job %s failed", job_id)
        jobstore.update_job_status(job_id, JobStatus.FAILED, error=str(e))
        return {"status": "failed", "error": str(e)}
