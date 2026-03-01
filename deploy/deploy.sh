#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="videoshelf"
CLUSTER="videoshelf"
SERVICE="videoshelf"
TASK_FAMILY="videoshelf"

REGION="${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "eu-west-1")}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

echo "==> Region:  ${REGION}"
echo "==> Account: ${ACCOUNT_ID}"
echo "==> ECR:     ${ECR_URI}"
echo ""

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Building image (linux/arm64)..."
docker buildx build --platform linux/arm64 \
  -t "${ECR_URI}:latest" \
  --push \
  "$(dirname "$0")/.."

echo "==> Forcing new ECS deployment..."
aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${SERVICE}" \
  --force-new-deployment \
  --region "${REGION}" \
  --query 'service.deployments[0].{status:status,running:runningCount,desired:desiredCount}' \
  --output table

echo ""
echo "==> Deploy triggered. Watch progress with:"
echo "    aws ecs describe-services --cluster ${CLUSTER} --services ${SERVICE} --region ${REGION} --query 'services[0].deployments'"
echo "    aws logs tail /ecs/videoshelf --follow --region ${REGION}"
