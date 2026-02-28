from pathlib import Path

from pydantic_settings import BaseSettings

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = {
        "env_prefix": "VS_",
        "env_file": PROJECT_ROOT / ".env",
        "env_file_encoding": "utf-8",
    }

    app_name: str = "VideoShelf"
    debug: bool = False

    upload_dir: Path = PROJECT_ROOT / "data" / "uploads"
    output_dir: Path = PROJECT_ROOT / "data" / "outputs"
    max_upload_size_mb: int = 2048

    # AWS
    aws_region: str = "eu-west-1"
    aws_endpoint_url: str = ""
    dynamodb_projects_table: str = "videoshelf-projects"
    dynamodb_jobs_table: str = "videoshelf-jobs"

    # SQS broker URL for Celery (empty = use redis_url as fallback)
    sqs_queue_name: str = "videoshelf"

    # Legacy Redis (only used when aws_endpoint_url points to LocalStack or for local dev)
    redis_url: str = ""

    # S3
    s3_bucket: str = "videoshelf"
    use_s3: bool = True

    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    allowed_extensions: set[str] = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv"}
    allowed_image_extensions: set[str] = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    allowed_output_formats: set[str] = {"mp4", "mkv", "webm", "mov"}

    @property
    def s3_endpoint(self) -> str | None:
        """Return endpoint URL for S3 (LocalStack/MinIO) or None for real AWS."""
        return self.aws_endpoint_url or None


settings = Settings()
