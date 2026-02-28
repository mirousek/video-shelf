"""Redis-backed project store for persisting editor state across sessions."""

from __future__ import annotations

import logging
from datetime import datetime

import redis

from app.config import settings
from app.models.schemas import Project

logger = logging.getLogger(__name__)

_redis: redis.Redis | None = None

PREFIX = "videoshelf:project:"


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _key(project_id: str) -> str:
    return f"{PREFIX}{project_id}"


def save_project(project: Project) -> None:
    project.updated_at = datetime.utcnow()
    _get_redis().set(_key(project.id), project.model_dump_json())


def get_project(project_id: str) -> Project | None:
    data = _get_redis().get(_key(project_id))
    if data is None:
        return None
    return Project.model_validate_json(data)


def list_projects() -> list[Project]:
    r = _get_redis()
    keys = list(r.scan_iter(match=f"{PREFIX}*", count=200))
    if not keys:
        return []
    values = r.mget(keys)
    projects = [Project.model_validate_json(v) for v in values if v is not None]
    projects.sort(key=lambda p: p.updated_at, reverse=True)
    return projects


def delete_project(project_id: str) -> bool:
    return _get_redis().delete(_key(project_id)) > 0
