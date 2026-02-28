# VideoShelf

Video processing and cutting backend built with FastAPI, Celery, FFmpeg, and Redis.

## Architecture

```
Client (FE) ──▶ FastAPI ──▶ Redis Queue ──▶ Celery Worker ──▶ FFmpeg
                  │                              │
                  ├── Upload/Download             ├── Cut segments
                  ├── Job status                  ├── Concatenate
                  └── WebSocket progress          └── Store output
```

**Components:**
- **FastAPI** — REST API + WebSocket for uploads, job management, and progress
- **Celery** — Async task queue for background video processing
- **Redis** — Message broker + job state store + pub/sub for progress
- **FFmpeg** — Video cutting, concatenation, and transcoding
- **MinIO** (optional) — S3-compatible object storage

## Quick Start

### With Docker Compose (recommended)

```bash
docker compose up --build
```

This starts: API (`:8000`), Redis (`:6379`), MinIO (`:9000`, console `:9001`), and a Celery worker.

### Local Development

Prerequisites: Python 3.11+, Node.js 18+, FFmpeg, Redis.

```bash
# Copy and edit environment config
cp .env.example .env
```

**1. Backend (FastAPI)**

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API starts at `http://localhost:8000`. The `--reload` flag auto-restarts on Python source changes.
You can also run it as a module for IDE debugging:

```bash
python -m uvicorn app.main:app --reload --port 8000
```

**2. Celery Worker**

In a separate terminal:

```bash
celery -A app.workers.celery_app worker --loglevel=info
```

Workers pick up export/processing jobs from the Redis queue. Restart the worker manually after code changes, or use `watchfiles` for auto-reload:

```bash
pip install watchfiles
watchfiles --filter python 'celery -A app.workers.celery_app worker --loglevel=info'
```

**3. Redis**

```bash
redis-server
```

Must be running before starting the API or workers. Default URL: `redis://localhost:6379/0` (configurable via `VS_REDIS_URL` in `.env`).

**4. Frontend (React + Vite)**

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with hot module replacement. It proxies API requests to the backend at `:8000`.

**Summary: 4 terminals**

| Terminal | Command | Port |
|----------|---------|------|
| Redis | `redis-server` | 6379 |
| Backend | `uvicorn app.main:app --reload --port 8000` | 8000 |
| Worker | `celery -A app.workers.celery_app worker --loglevel=info` | — |
| Frontend | `cd frontend && npm run dev` | 5173 |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload a video file |
| `POST` | `/api/jobs` | Create a cut/processing job |
| `GET` | `/api/jobs/{id}` | Get job status |
| `GET` | `/api/download/{job_id}/{file_index}` | Download processed file |
| `GET` | `/api/videos/{video_id}/info` | Get video metadata |
| `GET` | `/api/videos/{video_id}/thumbnail?t=1.0` | Get thumbnail at timestamp |
| `WS` | `/api/ws/jobs/{job_id}/progress` | Real-time progress updates |
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger UI |

## Usage Example

```bash
# 1. Upload a video
curl -X POST http://localhost:8000/api/upload \
  -F "file=@my_video.mp4"

# Response: {"video_id": "abc123.mp4", "info": {"duration": 120.5, ...}}

# 2. Create a cut job (extract two segments and concatenate)
curl -X POST http://localhost:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "abc123.mp4",
    "segments": [
      {"start": 10.0, "end": 30.0},
      {"start": 60.0, "end": 90.0}
    ],
    "output_format": "mp4",
    "concat": true
  }'

# Response: {"id": "job_xyz", "status": "pending", ...}

# 3. Poll job status
curl http://localhost:8000/api/jobs/job_xyz

# 4. Download result
curl -O http://localhost:8000/api/download/job_xyz/0
```

## Configuration

All settings are configured via environment variables prefixed with `VS_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VS_DEBUG` | `false` | Enable debug logging |
| `VS_REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL |
| `VS_USE_S3` | `false` | Enable S3 storage (MinIO) |
| `VS_S3_ENDPOINT` | `http://localhost:9000` | S3 endpoint |
| `VS_S3_ACCESS_KEY` | `minioadmin` | S3 access key |
| `VS_S3_SECRET_KEY` | `minioadmin` | S3 secret key |
| `VS_S3_BUCKET` | `videoshelf` | S3 bucket name |
| `VS_MAX_UPLOAD_SIZE_MB` | `2048` | Max upload size in MB |

See `.env.example` for a complete template.
