"""Optional Redis/Celery worker: celery -A backend.tasks worker --pool=solo."""

from celery import Celery
from .config import settings

celery_app = Celery("cdmento", broker=settings.redis_url or "redis://127.0.0.1:6379/0")
celery_app.conf.update(
    task_acks_late=True, worker_prefetch_multiplier=1, task_reject_on_worker_lost=True
)
celery_app.conf.beat_schedule = {
    "recover-stalled-jobs": {"task": "cdmento.recover", "schedule": 30.0}
}


@celery_app.task(name="cdmento.run_job")
def run_job(owner, job_id):
    from .main import create_services

    services = create_services(settings)
    services.run_job(owner, job_id)


@celery_app.task(name="cdmento.recover")
def recover():
    from .main import create_services

    services = create_services(settings)
    for owner, job in services.repo.all_jobs():
        if (
            job["status"] == "queued"
            or (
                job["status"] == "waiting"
                and job.get("retry_at", 0) <= __import__("time").time()
            )
            or (
                job["status"] == "processing"
                and job.get("lease_until", 0) < __import__("time").time()
            )
        ):
            celery_app.send_task("cdmento.run_job", args=[owner, job["id"]])
