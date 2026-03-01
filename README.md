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

## AWS Deployment (ECS on EC2)

Single EC2 instance managed by ECS. Deploy from your laptop with `./deploy/deploy.sh` — no SSH needed.

Estimated monthly cost after free tier: ~$10-15 (ECS control plane is free).

### Prerequisites

- AWS CLI configured (`aws configure`)
- Docker installed locally (for building/pushing images)
- Import your SSH public key (optional, for debugging):
  ```bash
  aws ec2 import-key-pair --key-name videoshelf --public-key-material fileb://~/.ssh/id_ed25519.pub --region $REGION
  ```

### 1. Set Shell Variables

```bash
REGION=eu-west-1
ENV=prod          # use "dev", "staging", etc. for other environments
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

### 2. Create DynamoDB Tables

```bash
aws dynamodb create-table \
  --table-name videoshelf-${ENV}-projects \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

aws dynamodb create-table \
  --table-name videoshelf-${ENV}-jobs \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

aws dynamodb update-time-to-live \
  --table-name videoshelf-${ENV}-jobs \
  --time-to-live-specification "Enabled=true,AttributeName=expires_at" \
  --region $REGION
```

### 3. Create SQS Queue

```bash
aws sqs create-queue \
  --queue-name videoshelf-${ENV}-celery \
  --attributes '{"VisibilityTimeout":"3600"}' \
  --region $REGION
```

### 4. Create S3 Bucket

```bash
aws s3 mb s3://videoshelf-${ENV}-media --region $REGION
```

### 5. Create ECR Repository

```bash
aws ecr create-repository --repository-name videoshelf --region $REGION
```

### 6. Create CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/videoshelf --region $REGION
aws logs put-retention-policy --log-group-name /ecs/videoshelf --retention-in-days 14 --region $REGION
```

### 7. Create IAM Roles

Three roles: EC2 instance role (ECS agent), task execution role (ECR pull + logs), task role (app permissions).

```bash
# --- EC2 instance role (for ECS agent) ---
aws iam create-role \
  --role-name videoshelf-ec2-instance \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam attach-role-policy \
  --role-name videoshelf-ec2-instance \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role
aws iam create-instance-profile --instance-profile-name videoshelf-ec2-instance
aws iam add-role-to-instance-profile \
  --instance-profile-name videoshelf-ec2-instance \
  --role-name videoshelf-ec2-instance

# --- ECS task execution role (pull images + write logs) ---
aws iam create-role \
  --role-name videoshelf-ecs-execution \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam attach-role-policy \
  --role-name videoshelf-ecs-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# --- ECS task role (app access to DynamoDB, SQS, S3) ---
aws iam create-role \
  --role-name videoshelf-ecs-task \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam put-role-policy \
  --role-name videoshelf-ecs-task \
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
        "Resource": ["arn:aws:s3:::videoshelf-*-media","arn:aws:s3:::videoshelf-*-media/*"]
      }
    ]
  }'
```

### 8. Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name videoshelf --region $REGION
```

### 9. Create Security Group

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region $REGION)

SG_ID=$(aws ec2 create-security-group \
  --group-name videoshelf-sg \
  --description "VideoShelf ECS instance" \
  --vpc-id $VPC_ID \
  --region $REGION \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION
```

### 10. Launch EC2 Instance (ECS-Optimized)

```bash
AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id \
  --query 'Parameters[0].Value' \
  --output text --region $REGION)

aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t4g.micro \
  --key-name videoshelf \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=videoshelf-ec2-instance \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
  --region $REGION \
  --user-data '#!/bin/bash
echo ECS_CLUSTER=videoshelf >> /etc/ecs/ecs.config
'
```

Wait for the instance to register with the cluster (~1-2 minutes):

```bash
aws ecs list-container-instances --cluster videoshelf --region $REGION
```

### 11. Register Task Definition & Create Service

```bash
aws ecs register-task-definition \
  --family videoshelf \
  --network-mode host \
  --requires-compatibilities EC2 \
  --execution-role-arn arn:aws:iam::${ACCOUNT_ID}:role/videoshelf-ecs-execution \
  --task-role-arn arn:aws:iam::${ACCOUNT_ID}:role/videoshelf-ecs-task \
  --container-definitions '[{
    "name": "videoshelf",
    "image": "'${ACCOUNT_ID}'.dkr.ecr.'${REGION}'.amazonaws.com/videoshelf:latest",
    "essential": true,
    "portMappings": [{"containerPort": 80, "hostPort": 80, "protocol": "tcp"}],
    "environment": [
      {"name": "VS_ENV", "value": "'${ENV}'"},
      {"name": "VS_USE_S3", "value": "true"},
      {"name": "PORT", "value": "80"}
    ],
    "mountPoints": [{"sourceVolume": "data", "containerPath": "/app/data"}],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/videoshelf",
        "awslogs-region": "'${REGION}'",
        "awslogs-stream-prefix": "ecs"
      }
    },
    "memory": 900
  }]' \
  --volumes '[{"name": "data", "host": {"sourcePath": "/home/ec2-user/videoshelf-data"}}]' \
  --region $REGION

aws ecs create-service \
  --cluster videoshelf \
  --service-name videoshelf \
  --task-definition videoshelf \
  --desired-count 1 \
  --deployment-configuration '{"maximumPercent":100,"minimumHealthyPercent":0}' \
  --region $REGION
```

The `minimumHealthyPercent: 0` allows ECS to stop the old task before starting the new one (required with a single instance).

### 12. First Deploy

Push your first image and the service will start automatically:

```bash
./deploy/deploy.sh
```

### 13. Access the App

```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].PublicIpAddress' \
  --output text --region $REGION
```

Open `http://<PUBLIC_IP>` in your browser.

### Viewing Logs

```bash
aws logs tail /ecs/videoshelf --follow --region $REGION
```

### Updating & Redeploying

**Option A — GitHub Actions (CI/CD):**

Push to `main` triggers `.github/workflows/deploy.yml` automatically. You can also trigger it manually from the Actions tab.

One-time setup — create an OIDC identity provider and a deploy role so GitHub can assume it without long-lived keys:

```bash
# Create the GitHub OIDC provider (once per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create the deploy role (replace OWNER/REPO with your GitHub repo)
GITHUB_REPO="OWNER/REPO"
aws iam create-role \
  --role-name videoshelf-github-deploy \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Federated": "arn:aws:iam::'$ACCOUNT_ID':oidc-provider/token.actions.githubusercontent.com"},
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
        "StringLike": {"token.actions.githubusercontent.com:sub": "repo:'$GITHUB_REPO':*"}
      }
    }]
  }'

# Grant it ECR push + ECS deploy permissions
aws iam put-role-policy \
  --role-name videoshelf-github-deploy \
  --policy-name deploy-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["ecr:GetAuthorizationToken"],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": ["ecr:BatchCheckLayerAvailability","ecr:GetDownloadUrlForLayer","ecr:BatchGetImage","ecr:PutImage","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload"],
        "Resource": "arn:aws:ecr:'$REGION':'$ACCOUNT_ID':repository/videoshelf"
      },
      {
        "Effect": "Allow",
        "Action": ["ecs:UpdateService","ecs:DescribeServices"],
        "Resource": "arn:aws:ecs:'$REGION':'$ACCOUNT_ID':service/videoshelf/videoshelf"
      }
    ]
  }'
```

Then add the role ARN as a GitHub repository secret:
- **Secret name**: `AWS_DEPLOY_ROLE_ARN`
- **Value**: `arn:aws:iam::<ACCOUNT_ID>:role/videoshelf-github-deploy`

**Option B — Manual from your laptop:**

```bash
./deploy/deploy.sh
```

To change environment variables, update the task definition's `environment` array and redeploy.

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
| `VS_ENV` | `prod` | Environment name (`dev`, `staging`, `prod`, …) |
| `VS_DYNAMODB_PROJECTS_TABLE` | `videoshelf-{env}-projects` | DynamoDB table for projects |
| `VS_DYNAMODB_JOBS_TABLE` | `videoshelf-{env}-jobs` | DynamoDB table for jobs |
| `VS_SQS_QUEUE_NAME` | `videoshelf-{env}` | SQS queue name prefix for Celery |
| `VS_S3_BUCKET` | `videoshelf-{env}-media` | S3 bucket name |
| `VS_USE_S3` | `true` | Enable S3 storage |
| `VS_REDIS_URL` | (empty) | Redis URL (only for local dev without SQS) |
| `VS_MAX_UPLOAD_SIZE_MB` | `2048` | Max upload size in MB |

All AWS resource names (DynamoDB tables, SQS queue, S3 bucket) are auto-derived from `VS_ENV`. Set only `VS_ENV` and all names adjust accordingly. Any individual name can still be overridden explicitly.

AWS credentials, region, and profile are managed by boto3's standard chain — configure via `aws configure` or set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` as environment variables. On EC2, use an IAM instance profile instead.

See `.env.example` for a complete template.
