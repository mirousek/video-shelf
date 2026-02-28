#!/usr/bin/env python3
"""One-time migration: copy projects and jobs from Redis to DynamoDB.

Usage:
    # Dry run (prints what would be migrated, writes nothing):
    python scripts/migrate_redis_to_dynamodb.py --dry-run

    # Migrate using settings from .env:
    python scripts/migrate_redis_to_dynamodb.py

    # Override Redis URL or DynamoDB endpoint:
    VS_REDIS_URL=redis://localhost:6379/0 \
    VS_AWS_ENDPOINT_URL=http://localhost:4566 \
      python scripts/migrate_redis_to_dynamodb.py

Prerequisites:
    pip install redis boto3 pydantic pydantic-settings
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import redis as redis_lib
import boto3

from app.config import settings
from app.models.schemas import Job, Project

PROJECT_PREFIX = "videoshelf:project:"
JOB_PREFIX = "videoshelf:job:"
JOB_TTL_SECONDS = 86400


def get_redis() -> redis_lib.Redis:
    url = settings.redis_url
    if not url:
        print("ERROR: VS_REDIS_URL is not set. Cannot connect to Redis.")
        sys.exit(1)
    return redis_lib.from_url(url, decode_responses=True)


def get_dynamodb_resource():
    kwargs = {"region_name": settings.aws_region}
    if settings.aws_endpoint_url:
        kwargs["endpoint_url"] = settings.aws_endpoint_url
    return boto3.resource("dynamodb", **kwargs)


def migrate_projects(r: redis_lib.Redis, dynamo, *, dry_run: bool) -> int:
    table = dynamo.Table(settings.dynamodb_projects_table)
    keys = list(r.scan_iter(match=f"{PROJECT_PREFIX}*", count=200))
    print(f"Found {len(keys)} project(s) in Redis.")

    migrated = 0
    for key in keys:
        project_id = key.removeprefix(PROJECT_PREFIX)
        data = r.get(key)
        if data is None:
            continue

        try:
            project = Project.model_validate_json(data)
        except Exception as e:
            print(f"  SKIP {project_id}: failed to parse ({e})")
            continue

        if dry_run:
            print(f"  [DRY RUN] Would migrate project: {project_id} ({project.name})")
        else:
            table.put_item(Item={
                "id": project.id,
                "data": project.model_dump_json(),
                "updated_at": project.updated_at.isoformat(),
            })
            print(f"  Migrated project: {project_id} ({project.name})")
        migrated += 1

    return migrated


def migrate_jobs(r: redis_lib.Redis, dynamo, *, dry_run: bool) -> int:
    table = dynamo.Table(settings.dynamodb_jobs_table)
    keys = list(r.scan_iter(match=f"{JOB_PREFIX}*", count=200))
    print(f"Found {len(keys)} job(s) in Redis.")

    migrated = 0
    for key in keys:
        job_id = key.removeprefix(JOB_PREFIX)
        data = r.get(key)
        if data is None:
            continue

        try:
            job = Job.model_validate_json(data)
        except Exception as e:
            print(f"  SKIP {job_id}: failed to parse ({e})")
            continue

        if dry_run:
            print(f"  [DRY RUN] Would migrate job: {job_id} (status={job.status})")
        else:
            table.put_item(Item={
                "id": job.id,
                "data": job.model_dump_json(),
                "expires_at": int(time.time()) + JOB_TTL_SECONDS,
            })
            print(f"  Migrated job: {job_id} (status={job.status})")
        migrated += 1

    return migrated


def main():
    parser = argparse.ArgumentParser(description="Migrate VideoShelf data from Redis to DynamoDB")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be migrated without writing")
    parser.add_argument("--skip-jobs", action="store_true", help="Only migrate projects, skip jobs")
    args = parser.parse_args()

    print(f"Redis URL: {settings.redis_url}")
    print(f"DynamoDB region: {settings.aws_region}")
    if settings.aws_endpoint_url:
        print(f"DynamoDB endpoint: {settings.aws_endpoint_url}")
    print(f"Projects table: {settings.dynamodb_projects_table}")
    print(f"Jobs table: {settings.dynamodb_jobs_table}")
    if args.dry_run:
        print("MODE: dry run (no writes)")
    print()

    r = get_redis()
    dynamo = get_dynamodb_resource()

    projects = migrate_projects(r, dynamo, dry_run=args.dry_run)
    print()

    jobs = 0
    if not args.skip_jobs:
        jobs = migrate_jobs(r, dynamo, dry_run=args.dry_run)
        print()

    print(f"Done. Projects: {projects}, Jobs: {jobs}.")
    if args.dry_run:
        print("This was a dry run. Re-run without --dry-run to actually migrate.")


if __name__ == "__main__":
    main()
