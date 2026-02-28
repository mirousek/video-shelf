# VideoShelf

Video processing and cutting tool built with FastAPI, Celery, FFmpeg, React, and AWS services.

## Architecture

```
Client (Browser) ──▶ FastAPI ──▶ SQS Queue ──▶ Celery Worker ──▶ FFmpeg
                       │                             │
                       ├── Upload/Download (S3)      ├── Cut segments
                       ├── Job status (DynamoDB)     ├── Concatenate
                       └── WebSocket progress        └── Store output (S3)
```

**Components:**
- **FastAPI** -- REST API + WebSocket for uploads, job management, and progress
- **Celery** -- Async task queue for background video processing
- **DynamoDB** -- Project and job state storage
- **SQS** -- Celery message broker
- **S3** -- Media file storage (uploads + outputs)
- **FFmpeg** -- Video cutting, concatenation, and transcoding

## Quick Start

### With Docker Compose

```bash
docker compose up --build
```

This starts: API (`:8000`), Celery worker, and Redis (`:6379`). DynamoDB and S3 are accessed on real AWS (configured via `.env`).

### Local Development

Prerequisites: Python 3.11+, Node.js 18+, FFmpeg, Redis, AWS CLI configured (`aws configure`).

```bash
cp .env.example .env
# Edit .env -- ensure AWS region is configured (aws configure or AWS_DEFAULT_REGION)
```

DynamoDB and S3 are used directly on AWS (free-tier eligible, pennies at dev usage). Redis is used locally as the Celery broker only.

**1. Redis (Celery broker)**

```bash
redis-server
```

**2. Backend (FastAPI)**

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**3. Celery Worker**

```bash
celery -A app.workers.celery_app worker --loglevel=info
```

Auto-reload with watchfiles:

```bash
pip install watchfiles
watchfiles --filter python 'celery -A app.workers.celery_app worker --loglevel=info'
```

**4. Frontend (React + Vite)**

```bash
cd frontend
npm install
npm run dev
```

Dev server at `http://localhost:5173` with HMR, proxying `/api` to `:8000`.

**Summary: 4 terminals**

| Terminal | Command | Port |
|----------|---------|------|
| Redis | `redis-server` | 6379 |
| Backend | `uvicorn app.main:app --reload --port 8000` | 8000 |
| Worker | `celery -A app.workers.celery_app worker --loglevel=info` | -- |
| Frontend | `cd frontend && npm run dev` | 5173 |

## AWS Deployment (Lowest Cost)

Estimated monthly cost after free tier: ~$10-15.

### Prerequisites

- AWS CLI configured (`aws configure`)
- Import your SSH public key to AWS:
  ```bash
  aws ec2 import-key-pair --key-name videoshelf --public-key-material fileb://~/.ssh/id_ed25519.pub --region $REGION
  ```
  (Replace `id_ed25519.pub` with your actual public key filename, e.g. `id_rsa.pub`)

### 1. Create DynamoDB Tables

```bash
REGION=eu-west-1

aws dynamodb create-table \
  --table-name videoshelf-projects \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

aws dynamodb create-table \
  --table-name videoshelf-jobs \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

aws dynamodb update-time-to-live \
  --table-name videoshelf-jobs \
  --time-to-live-specification "Enabled=true,AttributeName=expires_at" \
  --region $REGION
```

### 2. Create SQS Queue

```bash
aws sqs create-queue \
  --queue-name videoshelf-celery \
  --attributes '{"VisibilityTimeout":"3600"}' \
  --region $REGION
```

### 3. Create S3 Bucket

```bash
aws s3 mb s3://videoshelf-media --region $REGION
```

### 4. Create IAM Role

```bash
# Create the role
aws iam create-role \
  --role-name videoshelf-ec2 \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies
aws iam put-role-policy \
  --role-name videoshelf-ec2 \
  --policy-name videoshelf-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:DeleteItem","dynamodb:Scan","dynamodb:UpdateItem"],
        "Resource": "arn:aws:dynamodb:'$REGION':*:table/videoshelf-*"
      },
      {
        "Effect": "Allow",
        "Action": ["sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueUrl","sqs:GetQueueAttributes","sqs:ChangeMessageVisibility"],
        "Resource": "arn:aws:sqs:'$REGION':*:videoshelf-*"
      },
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket","s3:GetBucketLocation"],
        "Resource": ["arn:aws:s3:::videoshelf-media","arn:aws:s3:::videoshelf-media/*"]
      }
    ]
  }'

# Create instance profile
aws iam create-instance-profile --instance-profile-name videoshelf-ec2
aws iam add-role-to-instance-profile \
  --instance-profile-name videoshelf-ec2 \
  --role-name videoshelf-ec2
```

### 5. Create Security Group

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region $REGION)

SG_ID=$(aws ec2 create-security-group \
  --group-name videoshelf-sg \
  --description "VideoShelf web server" \
  --vpc-id $VPC_ID \
  --region $REGION \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION
```

### 6. Launch EC2 Instance

```bash
# Amazon Linux 2023 ARM (t4g.micro ~ $6/mo, free-tier eligible)
AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query 'Parameters[0].Value' \
  --output text --region $REGION)

aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t4g.micro \
  --key-name videoshelf \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=videoshelf-ec2 \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --region $REGION \
  --user-data '#!/bin/bash
set -ex
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Clone and build
cd /home/ec2-user
git clone <YOUR_REPO_URL> videoshelf
cd videoshelf

# Create .env (region is picked up from the instance metadata / IAM profile)
cat > .env << EOF
VS_USE_S3=true
VS_S3_BUCKET=videoshelf-media
VS_SQS_QUEUE_NAME=videoshelf
EOF

# Build and run
docker build -t videoshelf .
docker run -d --restart=unless-stopped \
  -p 80:8000 \
  --env-file .env \
  -v /home/ec2-user/videoshelf/data:/app/data \
  videoshelf
'
```

Replace `<YOUR_REPO_URL>` with your actual repository URL.

### 7. Access the App

```bash
# Get the public IP
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].PublicIpAddress' \
  --output text --region $REGION
```

Open `http://<PUBLIC_IP>` in your browser.

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

## Configuration

All settings are configured via environment variables prefixed with `VS_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VS_DEBUG` | `false` | Enable debug logging |
| `VS_DYNAMODB_PROJECTS_TABLE` | `videoshelf-projects` | DynamoDB table for projects |
| `VS_DYNAMODB_JOBS_TABLE` | `videoshelf-jobs` | DynamoDB table for jobs |
| `VS_SQS_QUEUE_NAME` | `videoshelf` | SQS queue name prefix for Celery |
| `VS_USE_S3` | `true` | Enable S3 storage |
| `VS_S3_BUCKET` | `videoshelf` | S3 bucket name |
| `VS_REDIS_URL` | (empty) | Redis URL (only for local dev without SQS) |
| `VS_MAX_UPLOAD_SIZE_MB` | `2048` | Max upload size in MB |

AWS credentials, region, and profile are managed by boto3's standard chain -- configure via `aws configure` or set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` as environment variables. On EC2, use an IAM instance profile instead.

See `.env.example` for a complete template.
