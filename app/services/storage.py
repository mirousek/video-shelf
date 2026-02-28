from __future__ import annotations

import logging
import shutil
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


def get_output_path(job_id: str, index: int, output_format: str) -> Path:
    _ensure_local_dirs()
    return settings.output_dir / f"{job_id}_{index}.{output_format}"


def get_concat_output_path(job_id: str, output_format: str) -> Path:
    _ensure_local_dirs()
    return settings.output_dir / f"{job_id}_final.{output_format}"


# --- S3 operations ---


def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(signature_version="s3v4"),
    )


def ensure_bucket() -> None:
    if not settings.use_s3:
        return
    client = _get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        client.create_bucket(Bucket=settings.s3_bucket)
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
