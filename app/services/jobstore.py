"""DynamoDB-backed job store for tracking processing jobs."""

from __future__ import annotations

import logging
import time
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from app.config import settings
from app.models.schemas import Job, JobStatus

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 86400

_table = None


def _get_table():
    global _table
    if _table is None:
        kwargs = {"region_name": settings.aws_region}
        if settings.aws_endpoint_url:
            kwargs["endpoint_url"] = settings.aws_endpoint_url
        dynamo = boto3.resource("dynamodb", **kwargs)
        _table = dynamo.Table(settings.dynamodb_jobs_table)
    return _table


def save_job(job: Job) -> None:
    job.updated_at = datetime.utcnow()
    _get_table().put_item(Item={
        "id": job.id,
        "data": job.model_dump_json(),
        "expires_at": int(time.time()) + JOB_TTL_SECONDS,
    })


def get_job(job_id: str) -> Job | None:
    try:
        resp = _get_table().get_item(Key={"id": job_id})
    except ClientError:
        logger.exception("Failed to get job %s", job_id)
        return None
    item = resp.get("Item")
    if item is None:
        return None
    return Job.model_validate_json(item["data"])


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
