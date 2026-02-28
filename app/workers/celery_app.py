from celery import Celery

from app.config import settings

broker_url = settings.redis_url if settings.redis_url else "sqs://"

celery = Celery(
    "videoshelf",
    broker=broker_url,
    backend=None,
)

transport_opts: dict = {}
if not settings.redis_url:
    transport_opts = {
        "region": settings.aws_region,
        "queue_name_prefix": f"{settings.sqs_queue_name}-",
    }
    if settings.aws_endpoint_url:
        transport_opts["endpoint_url"] = settings.aws_endpoint_url

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_transport_options=transport_opts,
)

celery.autodiscover_tasks(["app.workers"])
