import hashlib
import json
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4
from .repository import Conflict
from .documents import extract, NeedsOCR
from .providers.gateway import AIUnavailable, AIRefused
from .ai import PROMPT_REVISION


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier():
    return str(uuid4())


class Services:
    def __init__(self, settings, repo, storage, ai):
        self.settings, self.repo, self.storage, self.ai = settings, repo, storage, ai
        self.stop = threading.Event()
        self.worker = None

    def enqueue(self, owner, kind, **data):
        job = self.repo.put(
            owner,
            "jobs",
            {
                "id": identifier(),
                "kind": kind,
                "status": "queued",
                "created_at": now(),
                **data,
            },
        )
        if self.settings.redis_url:
            from .tasks import celery_app

            celery_app.send_task("cdmento.run_job", args=[owner, job["id"]])
        return job

    def start(self):
        if not self.settings.worker_enabled or self.settings.redis_url:
            return
        self.worker = threading.Thread(
            target=self.loop, daemon=True, name="cdmento-jobs"
        )
        self.worker.start()

    def loop(self):
        while not self.stop.wait(0.5):
            try:
                for owner, job in self.repo.all_jobs():
                    if (
                        job["status"] == "queued"
                        or (
                            job["status"] == "waiting"
                            and job.get("retry_at", 0) <= time.time()
                        )
                        or (
                            job["status"] == "processing"
                            and job.get("lease_until", 0) < time.time()
                        )
                    ):
                        self.run_job(owner, job["id"])
            except Exception:
                # Records retain their state for retries after a database/network failure.
                self.stop.wait(2)

    def run_job(self, owner, job_id):
        job = self.repo.get(owner, "jobs", job_id)
        if not job or job["status"] in ("completed", "failed"):
            return
        if job["status"] == "waiting" and job.get("retry_at", 0) > time.time():
            return
        if job["status"] == "processing" and job.get("lease_until", 0) > time.time():
            return
        try:
            job = self.repo.put(
                owner,
                "jobs",
                {**job, "status": "processing", "lease_until": time.time() + 600},
                expected=job["revision"],
            )
        except Conflict:
            return
        try:
            if job["kind"] == "ingest":
                self.ingest(owner, job)
            elif job["kind"] == "chat":
                self.chat(owner, job)
            elif job["kind"] == "delete_notebook":
                self.cleanup(owner, job["notebook"])
            else:
                self.generate(owner, job)
            self.repo.put(
                owner,
                "jobs",
                {
                    **{k: v for k, v in job.items() if k != "checkpoint"},
                    "status": "completed",
                    "finished_at": now(),
                },
                expected=job["revision"],
            )
        except AIUnavailable as error:
            attempts = job.get("retry_count", 0) + 1
            self.repo.put(
                owner,
                "jobs",
                {
                    **job,
                    "status": "waiting" if attempts <= 5 else "failed",
                    "retry_count": attempts,
                    "retry_at": time.time() + error.retry_after,
                    "error": str(error),
                    "error_kind": "quota",
                },
                expected=job["revision"],
            )
        except Exception as error:
            kind = (
                "refused"
                if isinstance(error, AIRefused)
                else "invalid_response"
                if isinstance(error, ValueError)
                else "connection"
            )
            public = (
                str(error)
                if isinstance(error, (ValueError, NeedsOCR))
                else "Processing failed. Check the server configuration and retry."
            )
            self.repo.put(
                owner,
                "jobs",
                {
                    **job,
                    "status": "failed",
                    "error": public,
                    "error_kind": kind,
                    "finished_at": now(),
                },
                expected=job["revision"],
            )
            if job["kind"] == "ingest":
                source = self.repo.get(owner, "sources", job["source_id"])
                if source:
                    self.repo.put(
                        owner,
                        "sources",
                        {
                            **source,
                            "status": "needs_ocr"
                            if isinstance(error, NeedsOCR)
                            else "failed",
                            "error": public,
                        },
                    )

    def ingest(self, owner, job):
        source = self.repo.get(owner, "sources", job["source_id"])
        notebook = self.repo.get(owner, "notebooks", job["notebook"])
        if not source or not notebook or notebook.get("deleting"):
            return
        self.repo.put(owner, "sources", {**source, "status": "extracting"})

        def progress(page_number, total, phase):
            current = self.repo.get(owner, "sources", source["id"])
            parent = self.repo.get(owner, "notebooks", source["notebook"])
            if not current or not parent or parent.get("deleting"):
                raise ValueError("This source is no longer available.")
            self.repo.put(
                owner,
                "sources",
                {
                    **current,
                    "status": phase,
                    "processing_page": page_number,
                    "page_count": total,
                },
            )
            job.update(
                self.repo.put(
                    owner,
                    "jobs",
                    {
                        **job,
                        "progress": page_number,
                        "total": total,
                        "lease_until": time.time() + 600,
                    },
                    expected=job["revision"],
                )
            )

        text, chunks = extract(
            self.storage.get(source["storage_key"]),
            source["type"],
            ocr=self.settings.ocr_enabled,
            max_ocr_pages=self.settings.ocr_max_pages,
            on_progress=progress,
        )
        source = {
            **source,
            "text": text,
            "chunks": chunks,
            "status": "ready",
            "processing_page": None,
            "page_count": max((c.get("page", 0) for c in chunks), default=0),
            "ocr_pages": sorted({c["page"] for c in chunks if c.get("ocr")}),
            "error": None,
        }
        if self.repo.get(owner, "sources", source["id"]) and self.repo.get(
            owner, "notebooks", notebook["id"]
        ):
            self.repo.put(owner, "sources", source)

    def generate(self, owner, job):
        parent = self.repo.get(owner, "notebooks", job["notebook"])
        if not parent or parent.get("deleting"):
            raise ValueError("This notebook is no longer available.")
        sources = [self.repo.get(owner, "sources", sid) for sid in job["source_ids"]]
        if not sources or any(not s or s["status"] != "ready" for s in sources):
            raise ValueError("One of the selected sources is no longer available.")
        versions = {
            source["id"]: hashlib.sha256(source["text"].encode()).hexdigest()
            for source in sources
        }
        if job.get("input_versions") and job["input_versions"] != versions:
            raise ValueError(
                "The selected material changed. Create a new reviewer instead of reusing its checkpoint."
            )
        job["input_versions"] = versions
        ai = self.ai_for(owner)

        def checkpoint(results):
            updated = self.repo.put(
                owner,
                "jobs",
                {
                    **job,
                    "checkpoint": results,
                    "progress": len(results),
                    "lease_until": time.time() + 600,
                },
                expected=job["revision"],
            )
            job.update(updated)

        if job["request"]["kind"] == "guide" and hasattr(ai, "reviewer"):
            result = ai.reviewer(
                job["request"], sources, job.get("checkpoint"), checkpoint
            )
        else:
            result = ai.generate(job["request"], sources)
        parent = self.repo.get(owner, "notebooks", job["notebook"])
        if not parent or parent.get("deleting"):
            return
        artifact = {
            "id": job["artifact_id"],
            "notebook": job["notebook"],
            "kind": job["request"]["kind"],
            "created_at": now(),
            "source_ids": job["source_ids"],
            "source_versions": {s["id"]: s.get("checksum") for s in sources},
            "cache_key": job["cache_key"],
            **result,
        }
        if artifact["kind"] == "flashcards":
            seen, cards = set(), []
            for card in artifact["cards"]:
                key = card["question"].strip().casefold()
                if key not in seen:
                    seen.add(key)
                    cards.append({**card, "id": identifier(), "accepted": False})
            artifact["cards"] = cards
        elif artifact["kind"] == "quiz":
            artifact["questions"] = [
                {
                    **question,
                    "id": identifier(),
                    "options": [
                        {"id": str(i), "text": text}
                        for i, text in enumerate(question["options"])
                    ],
                    "correct": str(question["correct"]),
                }
                for question in artifact["questions"]
            ]
        self.repo.put(owner, "artifacts", artifact)

    def delete_source(self, owner, source):
        if source.get("storage_key"):
            self.storage.delete(source["storage_key"])
        self.repo.delete(owner, "sources", source["id"])

    def cleanup(self, owner, notebook_id):
        notebook = self.repo.get(owner, "notebooks", notebook_id)
        for source in self.repo.list(owner, "sources"):
            if source["notebook"] == notebook_id:
                self.delete_source(owner, source)
        for kind in (
            "notes",
            "artifacts",
            "attempts",
            "conversations",
            "reviews",
            "maps",
        ):
            for item in self.repo.list(owner, kind):
                if item.get("notebook") == notebook_id:
                    self.repo.delete(owner, kind, item["id"])
        self.repo.delete(owner, "notebooks", notebook_id)

    def save_answer(self, owner, nid, question, result, history, answer_id=None):
        answer_id = answer_id or identifier()
        existing = next((m for m in history["messages"] if m["id"] == answer_id), None)
        if existing:
            return existing
        sources = {
            s["id"]: s for s in self.repo.list(owner, "sources") if s["notebook"] == nid
        }
        citations = [
            {**c, "name": sources[c["source_id"]]["name"]}
            for c in result.get("citations", [])
            if c["source_id"] in sources
        ] or [
            {"source_id": sid, "name": sources[sid]["name"]}
            for sid in result["source_ids"]
            if sid in sources
        ]
        messages = [
            *history["messages"],
            {"id": identifier(), "role": "user", "text": question, "created_at": now()},
            {
                "id": answer_id,
                "role": "assistant",
                "text": result["answer"],
                "citations": citations,
                "ai": result.get("_ai"),
                "created_at": now(),
            },
        ]
        summary = (
            history.get("summary", "")
            + "\n"
            + "\n".join(f"{m['role']}: {m['text'][:200]}" for m in messages[:-100])
        )[-4000:]
        self.repo.put(
            owner,
            "conversations",
            {**history, "messages": messages[-100:], "summary": summary},
            expected=history.get("revision", 0),
        )
        return messages[-1]

    def chat(self, owner, job):
        parent = self.repo.get(owner, "notebooks", job["notebook"])
        if not parent or parent.get("deleting"):
            raise ValueError("This notebook is no longer available.")
        history = self.repo.get(owner, "conversations", job["notebook"]) or {
            "id": job["notebook"],
            "notebook": job["notebook"],
            "messages": [],
        }
        if any(m["id"] == job["id"] for m in history["messages"]):
            return
        sources = [self.repo.get(owner, "sources", sid) for sid in job["source_ids"]]
        if not sources or any(not s or s["status"] != "ready" for s in sources):
            raise ValueError("A selected source is no longer available.")
        result = self.ai_for(owner).answer(
            {**parent, "conversation_summary": history.get("summary", "")},
            sources,
            job["question"],
            history["messages"],
        )
        self.save_answer(
            owner, job["notebook"], job["question"], result, history, job["id"]
        )

    def ai_for(self, owner):
        # Provider choice is automatic. The gateway tries the configured
        # providers in order and falls through on quota or connection errors.
        return self.ai

    def cache_key(self, request, sources):
        material = {
            "request": request,
            "sources": sorted((s["id"], s.get("checksum"), s["name"]) for s in sources),
            "model": [
                self.settings.groq_model,
                self.settings.openrouter_model,
                self.settings.cloudflare_model,
                self.settings.freellmapi_model,
                self.settings.freellmapi_base_url,
            ],
            "version": PROMPT_REVISION,
        }
        return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()
