#!/bin/bash
set -e

if [ -z "$AWS_DEFAULT_REGION" ]; then
  TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    AWS_DEFAULT_REGION=$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || true)
    export AWS_DEFAULT_REGION
  fi
fi

exec "$@"
