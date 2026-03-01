from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = {
        "env_prefix": "VS_",
        "env_file": PROJECT_ROOT / ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    app_name: str = "VideoShelf"
    debug: bool = False
    env: str = "prod"

    upload_dir: Path = PROJECT_ROOT / "data" / "uploads"
    output_dir: Path = PROJECT_ROOT / "data" / "outputs"
    max_upload_size_mb: int = 2048

    # AWS — leave empty to auto-derive from env (e.g. "videoshelf-dev-projects")
    aws_endpoint_url: str = ""
    dynamodb_projects_table: str = ""
    dynamodb_jobs_table: str = ""
    sqs_queue_name: str = ""
    s3_bucket: str = ""

    # Redis (used as Celery broker for local dev; on EC2, SQS is used instead)
    redis_url: str = ""

    # S3
    use_s3: bool = True

    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    allowed_extensions: set[str] = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv"}
    allowed_image_extensions: set[str] = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    allowed_output_formats: set[str] = {"mp4", "mkv", "webm", "mov"}

    @model_validator(mode="after")
    def _apply_env_defaults(self) -> "Settings":
        prefix = f"videoshelf-{self.env}"
        if not self.dynamodb_projects_table:
            self.dynamodb_projects_table = f"{prefix}-projects"
        if not self.dynamodb_jobs_table:
            self.dynamodb_jobs_table = f"{prefix}-jobs"
        if not self.sqs_queue_name:
            self.sqs_queue_name = prefix
        if not self.s3_bucket:
            self.s3_bucket = f"{prefix}-media"
        return self

    @property
    def s3_endpoint(self) -> str | None:
        """Return endpoint URL for S3 (LocalStack/MinIO) or None for real AWS."""
        return self.aws_endpoint_url or None


settings = Settings()
