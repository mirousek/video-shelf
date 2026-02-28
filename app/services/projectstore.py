"""DynamoDB-backed project store for persisting editor state across sessions."""

from __future__ import annotations

import logging
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from app.config import settings
from app.models.schemas import Project

logger = logging.getLogger(__name__)

_table = None


def _get_table():
    global _table
    if _table is None:
        kwargs = {"region_name": settings.aws_region}
        if settings.aws_endpoint_url:
            kwargs["endpoint_url"] = settings.aws_endpoint_url
        dynamo = boto3.resource("dynamodb", **kwargs)
        _table = dynamo.Table(settings.dynamodb_projects_table)
    return _table


def save_project(project: Project) -> None:
    project.updated_at = datetime.utcnow()
    _get_table().put_item(Item={
        "id": project.id,
        "data": project.model_dump_json(),
        "updated_at": project.updated_at.isoformat(),
    })


def _migrate_project(project: Project) -> Project:
    """Backfill segment IDs and clip segment_id references for pre-ID projects."""
    needs_save = False

    for video in project.videos:
        for seg in video.segments:
            if not seg.id:
                needs_save = True

    for clip in project.output_timeline:
        if clip.segment_id is None and clip.photo_duration is None:
            for video in project.videos:
                if video.video_id != clip.video_id:
                    continue
                match = next(
                    (s for s in video.segments if s.start == clip.start and s.end == clip.end),
                    None,
                )
                if match:
                    clip.segment_id = match.id
                    needs_save = True
                    break

    if needs_save:
        save_project(project)

    return project


def get_project(project_id: str) -> Project | None:
    try:
        resp = _get_table().get_item(Key={"id": project_id})
    except ClientError:
        logger.exception("Failed to get project %s", project_id)
        return None
    item = resp.get("Item")
    if item is None:
        return None
    return _migrate_project(Project.model_validate_json(item["data"]))


def list_projects() -> list[Project]:
    resp = _get_table().scan(ProjectionExpression="id, #d, updated_at", ExpressionAttributeNames={"#d": "data"})
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = _get_table().scan(
            ProjectionExpression="id, #d, updated_at",
            ExpressionAttributeNames={"#d": "data"},
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    projects = []
    for item in items:
        try:
            projects.append(_migrate_project(Project.model_validate_json(item["data"])))
        except Exception:
            logger.exception("Failed to deserialize project %s", item.get("id"))
    projects.sort(key=lambda p: p.updated_at, reverse=True)
    return projects


def delete_project(project_id: str) -> bool:
    try:
        _get_table().delete_item(
            Key={"id": project_id},
            ConditionExpression="attribute_exists(id)",
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
