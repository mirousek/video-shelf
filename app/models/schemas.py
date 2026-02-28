from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class CutSegment(BaseModel):
    """A single cut segment defined by start and end timestamps in seconds."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    start: float = Field(ge=0, description="Start time in seconds")
    end: float = Field(gt=0, description="End time in seconds")


class VideoInfo(BaseModel):
    filename: str
    duration: float
    width: int
    height: int
    codec: str
    fps: float
    size_bytes: int
    media_type: str = "video"


class Clip(BaseModel):
    """A single clip: a segment from a specific video, or a photo with a duration."""

    video_id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    photo_duration: float | None = None
    segment_id: str | None = None


class JobCreate(BaseModel):
    clips: list[Clip] = Field(min_length=1)
    output_format: str = "mp4"
    concat: bool = Field(
        default=True,
        description="If True, concatenate all clips into one file. If False, export each separately.",
    )
    crf: int = Field(default=18, ge=0, le=51, description="H.264 CRF value (0=lossless, 51=worst). Lower = better quality.")
    preset: str = Field(default="medium", description="x264 encoding preset (ultrafast..veryslow). Slower = better quality per bit.")


class Job(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    clips: list[Clip]
    output_format: str
    concat: bool
    crf: int = 18
    preset: str = "medium"
    status: JobStatus = JobStatus.PENDING
    progress: float = 0.0
    output_files: list[str] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class JobResponse(BaseModel):
    id: str
    status: JobStatus
    progress: float
    output_files: list[str]
    error: str | None
    created_at: datetime
    updated_at: datetime


class UploadResponse(BaseModel):
    video_id: str
    info: VideoInfo


# --- Projects ---


class ProjectVideo(BaseModel):
    """A single video within a project, with its own cut segments."""

    video_id: str
    video_info: VideoInfo
    segments: list[CutSegment] = Field(default_factory=list)


class Project(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str
    videos: list[ProjectVideo] = Field(default_factory=list)
    output_timeline: list[Clip] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectCreate(BaseModel):
    name: str
    videos: list[ProjectVideo] = Field(default_factory=list)
    output_timeline: list[Clip] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = None
    videos: list[ProjectVideo] | None = None
    output_timeline: list[Clip] | None = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    videos: list[ProjectVideo]
    output_timeline: list[Clip]
    created_at: datetime
    updated_at: datetime
