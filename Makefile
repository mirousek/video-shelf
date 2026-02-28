.PHONY: api worker frontend

api:
	VS_DEBUG=true python -m app

worker:
	watchmedo auto-restart --directory=app --pattern="*.py" --recursive -- \
		celery -A app.workers.celery_app worker --loglevel=info

frontend:
	cd frontend && npm run dev
