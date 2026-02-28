from __future__ import annotations

import logging
import uuid
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


def _ensure_local_dirs() -> None:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.output_dir.mkdir(parents=True, exist_ok=True)


def generate_video_id(original_filename: str) -> str:
    ext = Path(original_filename).suffix
    return f"{uuid.uuid4().hex}{ext}"


def get_upload_path(video_id: str) -> Path:
    _ensure_local_dirs()
    return settings.upload_dir / video_id


def get_preview_path(video_id: str) -> Path:
    _ensure_local_dirs()
    stem = Path(video_id).stem
    return settings.upload_dir / f"{stem}_preview.mp4"


def _output_base(project_id: str = "") -> Path:
    base = settings.output_dir / project_id if project_id else settings.output_dir
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_output_path(job_id: str, index: int, output_format: str, project_id: str = "") -> Path:
    _ensure_local_dirs()
    return _output_base(project_id) / f"{job_id}_{index}.{output_format}"


def get_concat_output_path(job_id: str, output_format: str, project_id: str = "") -> Path:
    _ensure_local_dirs()
    return _output_base(project_id) / f"{job_id}_final.{output_format}"


def get_thumbnail_path(video_id: str) -> Path:
    thumbs_dir = settings.output_dir / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    return thumbs_dir / f"thumb_{video_id}.jpg"


# --- S3 operations ---


def _get_s3_client():
    kwargs: dict = {
        "config": BotoConfig(signature_version="s3v4"),
    }
    if settings.s3_endpoint:
        kwargs["endpoint_url"] = settings.s3_endpoint
    return boto3.client("s3", **kwargs)


def ensure_bucket() -> None:
    if not settings.use_s3:
        return
    client = _get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        region = boto3.session.Session().region_name or "us-east-1"
        create_kwargs: dict = {"Bucket": settings.s3_bucket}
        if region != "us-east-1":
            create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        client.create_bucket(**create_kwargs)
        logger.info("Created S3 bucket: %s", settings.s3_bucket)


def upload_to_s3(local_path: Path, s3_key: str) -> str:
    client = _get_s3_client()
    client.upload_file(str(local_path), settings.s3_bucket, s3_key)
    return s3_key


def generate_presigned_url(s3_key: str, expires_in: int = 3600) -> str:
    client = _get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )


def cleanup_local(path: Path) -> None:
    """Remove a local file after it's been uploaded to S3."""
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        logger.warning("Failed to clean up %s: %s", path, e)
