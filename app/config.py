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

    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "videoshelf"
    s3_region: str = "us-east-1"
    use_s3: bool = False

    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    allowed_extensions: set[str] = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv"}
    allowed_image_extensions: set[str] = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    allowed_output_formats: set[str] = {"mp4", "mkv", "webm", "mov"}


settings = Settings()
