"""Simple Redis-backed job store for tracking processing jobs."""

from __future__ import annotations

import json
import logging
from datetime import datetime

import redis

from app.config import settings
from app.models.schemas import Job, JobStatus

logger = logging.getLogger(__name__)

_redis: redis.Redis | None = None


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _key(job_id: str) -> str:
    return f"videoshelf:job:{job_id}"


def save_job(job: Job) -> None:
    job.updated_at = datetime.utcnow()
    _get_redis().set(_key(job.id), job.model_dump_json(), ex=86400)


def get_job(job_id: str) -> Job | None:
    data = _get_redis().get(_key(job_id))
    if data is None:
        return None
    return Job.model_validate_json(data)


def update_job_status(
    job_id: str,
    status: JobStatus,
    progress: float | None = None,
    error: str | None = None,
    output_files: list[str] | None = None,
) -> Job | None:
    job = get_job(job_id)
    if job is None:
        return None

    job.status = status
    if progress is not None:
        job.progress = progress
    if error is not None:
        job.error = error
    if output_files is not None:
        job.output_files = output_files

    save_job(job)
    return job


def publish_progress(job_id: str, progress: float) -> None:
    """Publish progress update to a Redis channel for WebSocket relay."""
    _get_redis().publish(
        f"videoshelf:progress:{job_id}",
        json.dumps({"job_id": job_id, "progress": progress}),
    )
