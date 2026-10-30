import copy
import hashlib
import json
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fsrs import Scheduler, Card, Rating
from .config import settings
from .repository import Repository, FirestoreRepository, Conflict
from .storage import FileStorage
from .ai import AIService
from .services import Services, now, identifier
from . import schemas as S
from .demo_auth import DemoAuth
from .documents import reading_sections
from .providers.gateway import AIUnavailable, AIRefused


def create_services(config):
    config.validate_modes()
    bucket = None
    if config.auth_mode == "firebase" or config.data_backend == "firestore":
        import firebase_admin
        from firebase_admin import firestore, storage

        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(
                options={
                    "projectId": config.firebase_project_id or None,
                    "storageBucket": config.firebase_storage_bucket or None,
                }
            )
        if config.data_backend == "firestore":
            bucket = storage.bucket()
            repo = FirestoreRepository(firestore.client(), bucket)
        else:
            repo = Repository(config.data_dir)
    else:
        repo = Repository(config.data_dir)
    return Services(
        config, repo, FileStorage(config.data_dir, bucket), AIService(config, repo)
    )


def user(request: Request):
    config = request.app.state.services.settings
    if config.auth_mode == "local":
        if request.client and request.client.host not in (
            "127.0.0.1",
            "::1",
            "testclient",
        ):
            raise HTTPException(403, "Local mode only accepts loopback connections.")
        authorization = request.headers.get("authorization", "")
        if authorization:
            if not authorization.startswith("Bearer "):
                raise HTTPException(401, "Sign in to your demo account again.")
            return request.app.state.demo_auth.resolve(authorization[7:])
        return "local-workspace"
    token = request.headers.get("authorization", "")
    if not token.startswith("Bearer "):
        raise HTTPException(401, "Sign in to your account to continue.")
    try:
        from firebase_admin import auth

        claims = auth.verify_id_token(token[7:], check_revoked=True)
    except Exception:
        raise HTTPException(
            401, "Your session expired. Please sign in again."
        ) from None
    if not claims.get("email_verified"):
        raise HTTPException(403, "Verify your email before opening your workspace.")
    request.state.account_claims = claims
    return claims["uid"]


Owner = Annotated[str, Depends(user)]


def create_app(config=None, services=None):
    service = services or create_services(config or settings)
    repo = service.repo
    locks = defaultdict(threading.RLock)
    requests = defaultdict(deque)

    @asynccontextmanager
    async def lifespan(app):
        service.start()
        yield
        service.stop.set()
        if service.worker:
            service.worker.join(timeout=3)

    app = FastAPI(title="CdMento API", version="1.0.0", lifespan=lifespan)
    app.state.services = service
    app.state.demo_auth = DemoAuth(repo)
    if service.settings.auth_mode == "local":
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=["127.0.0.1", "localhost", "testserver", "[::1]"],
        )

    @app.middleware("http")
    async def request_guard(request, call_next):
        origin = request.headers.get("origin")
        if (
            service.settings.auth_mode == "local"
            and origin
            and origin
            not in (
                "http://127.0.0.1:5173",
                "http://localhost:5173",
                "http://127.0.0.1:8000",
                "http://localhost:8000",
            )
        ):
            return JSONResponse(
                {"error": "This origin is not allowed in local mode."}, status_code=403
            )
        if (
            int(request.headers.get("content-length", "0") or 0)
            > service.settings.max_upload_bytes + 1024 * 1024
        ):
            return JSONResponse(
                {"error": "The upload exceeds the 10 MB limit."}, status_code=413
            )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        if isinstance(error.detail, dict):
            return JSONResponse(error.detail, status_code=error.status_code)
        return JSONResponse({"error": error.detail}, status_code=error.status_code)

    @app.exception_handler(Conflict)
    async def conflict_error(request, error):
        return JSONResponse({"error": str(error)}, status_code=409)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse(
            {
                "error": "Invalid request data.",
                "fields": [
                    {"field": ".".join(map(str, e["loc"])), "message": e["msg"]}
                    for e in error.errors()
                ],
            },
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        return JSONResponse(
            {
                "error": "The server could not complete this request. Your saved data has not been reset."
            },
            status_code=500,
        )

    def owned(owner, kind, record_id):
        value = repo.get(owner, kind, record_id)
        if not value or value.get("deleting"):
            raise HTTPException(404, "This item does not exist in your workspace.")
        if kind not in ("jobs", "notebooks") and value.get("notebook"):
            parent = repo.get(owner, "notebooks", value["notebook"])
            if not parent or parent.get("deleting"):
                raise HTTPException(404, "This notebook is no longer available.")
        return value

    def notebook(owner, notebook_id):
        return owned(owner, "notebooks", notebook_id)

    def selected(owner, notebook_id, ids=None):
        notebook(owner, notebook_id)
        sources = [
            s for s in repo.list(owner, "sources") if s["notebook"] == notebook_id
        ]
        if ids is not None:
            if not ids:
                raise HTTPException(400, "Select at least one source.")
            if not set(ids).issubset({s["id"] for s in sources}):
                raise HTTPException(404, "A selected source is not in this notebook.")
            sources = [s for s in sources if s["id"] in ids]
        else:
            sources = [s for s in sources if s["status"] == "ready"]
        if not sources:
            raise HTTPException(400, "Add a readable source to this notebook first.")
        if any(s["status"] != "ready" for s in sources):
            raise HTTPException(
                409, "Wait for the selected sources to finish processing."
            )
        return sources

    def ai_ready(owner):
        try:
            service.ai.require()
        except ValueError as error:
            raise HTTPException(
                503, {"error": str(error), "kind": "connection"}
            ) from None
        with locks["limits"]:
            queue = requests[owner]
            while queue and queue[0] < time.time() - 60:
                queue.popleft()
            if len(queue) >= 15:
                raise HTTPException(
                    429,
                    {
                        "error": "Please wait a minute before sending more AI requests.",
                        "kind": "rate_limit",
                    },
                )
            queue.append(time.time())

    @app.get("/api/v1/ai/status")
    def ai_status(owner: Owner):
        status = (
            service.ai.status()
            if hasattr(service.ai, "status")
            else {"configured": True, "free_only": True, "providers": []}
        )
        # Routing is automatic: every configured provider may receive requests,
        # and the gateway falls through to the next one when quota runs out.
        approved = [p["name"] for p in status.get("providers", [])]
        return {
            **status,
            "automatic": True,
            "approved_providers": approved,
        }

    def public_source(source):
        return {
            k: v
            for k, v in source.items()
            if k not in ("storage_key", "provider_file_id", "chunks")
        }

    def public_artifact(value):
        value = copy.deepcopy(value)
        if value["kind"] == "quiz":
            for question in value["questions"]:
                for key in ("correct", "explanation"):
                    question.pop(key, None)
        return value

    @app.get("/api/v1/health")
    def health():
        return {
            "status": "ok",
            "backend": "python",
            "auth_mode": service.settings.auth_mode,
            "data_backend": service.settings.data_backend,
            "ai_configured": getattr(service.ai, "configured", False),
            "demo_account_available": service.settings.auth_mode == "local"
            and app.state.demo_auth.available(),
        }

    def local_demo(request):
        if (
            service.settings.auth_mode != "local"
            or service.settings.data_backend != "sqlite"
        ):
            raise HTTPException(404, "Local demo sign-in is not enabled.")
        if not request.client or request.client.host not in (
            "127.0.0.1",
            "::1",
            "testclient",
        ):
            raise HTTPException(403, "Demo accounts only work on this computer.")
        return app.state.demo_auth

    @app.post("/api/v1/auth/demo/login")
    def demo_login(data: S.DemoLogin, request: Request):
        auth = local_demo(request)
        return auth.login(data.email, data.password, request.client.host)

    @app.get("/api/v1/auth/demo/session")
    def demo_session(request: Request):
        auth = local_demo(request)
        token = request.headers.get("authorization", "")
        if not token.startswith("Bearer "):
            raise HTTPException(401, "Sign in to your demo account.")
        auth.resolve(token[7:])
        return auth.profile()

    @app.post("/api/v1/auth/demo/logout", status_code=204)
    def demo_logout(request: Request):
        auth = local_demo(request)
        token = request.headers.get("authorization", "")
        if token.startswith("Bearer "):
            auth.logout(token[7:])
        return Response(status_code=204)

    @app.get("/api/v1/me")
    def me(owner: Owner):
        return {"id": owner, "mode": service.settings.auth_mode}

    @app.put("/api/v1/me/profile")
    def save_account_profile(request: Request, owner: Owner):
        if service.settings.auth_mode != "firebase":
            raise HTTPException(503, "Cloud accounts are not configured.")
        claims = request.state.account_claims
        with locks[owner]:
            previous = repo.get(owner, "profile", "account") or {}
            return repo.put(
                owner,
                "profile",
                {
                    **previous,
                    "id": "account",
                    "email": claims.get("email", ""),
                    "display_name": previous.get(
                        "display_name", claims.get("name", "")
                    ),
                    "email_verified": True,
                    "created_at": previous.get("created_at", now()),
                    "updated_at": now(),
                },
            )

    @app.get("/api/v1/me/profile")
    def account_profile(request: Request, owner: Owner):
        claims = getattr(request.state, "account_claims", {})
        existing = repo.get(owner, "profile", "account") or {}
        demo = app.state.demo_auth.profile() if owner == "demo-student" else {}
        return {
            "display_name": claims.get("name") or demo.get("displayName") or "Student",
            "bio": "",
            "study_goal": "",
            "avatar": "initials",
            "color": "purple",
            **existing,
            "email": claims.get("email") or demo.get("email") or "",
        }

    @app.patch("/api/v1/me/profile")
    def update_account_profile(data: S.AccountProfile, request: Request, owner: Owner):
        with locks[owner]:
            previous = repo.get(owner, "profile", "account") or {}
            repo.put(
                owner,
                "profile",
                {
                    **previous,
                    **data.model_dump(),
                    "id": "account",
                    "created_at": previous.get("created_at", now()),
                    "updated_at": now(),
                },
            )
        return account_profile(request, owner)

    @app.get("/api/v1/workspace")
    @app.get("/api/v1/workspace/export")
    def workspace(owner: Owner):
        notebooks = [n for n in repo.list(owner, "notebooks") if not n.get("deleting")]
        ids = {n["id"] for n in notebooks}
        return {
            "notebooks": [
                {k: v for k, v in n.items() if k != "vector_store_id"}
                for n in notebooks
            ],
            "sources": [
                public_source(s)
                for s in repo.list(owner, "sources")
                if s["notebook"] in ids
            ],
            "notes": [n for n in repo.list(owner, "notes") if n["notebook"] in ids],
            "artifacts": [
                public_artifact(a)
                for a in repo.list(owner, "artifacts")
                if a["notebook"] in ids
            ],
            "conversations": [
                c for c in repo.list(owner, "conversations") if c["notebook"] in ids
            ],
            "focus_sessions": [
                f
                for f in repo.list(owner, "focus_sessions")
                if not f.get("notebook") or f["notebook"] in ids
            ],
            "tasks": [t for t in repo.list(owner, "tasks")],
            "reviews": [
                r for r in repo.list(owner, "reviews") if r.get("notebook") in ids
            ],
            "attempts": [
                a for a in repo.list(owner, "attempts") if a["notebook"] in ids
            ],
            "maps": [m for m in repo.list(owner, "maps") if m["notebook"] in ids],
        }

    @app.post("/api/v1/workspace/import")
    def import_workspace(data: dict, owner: Owner):
        from .documents import extract

        if len(json.dumps(data)) > 5_000_000:
            raise HTTPException(
                413, "Import one notebook at a time; this backup exceeds 5 MB."
            )
        try:
            notebooks = [
                S.NotebookInput.model_validate(
                    {k: n[k] for k in ("id", "name", "color") if k in n}
                )
                for n in data.get("notebooks", [])
            ]
            ids = {n.id for n in notebooks}
            notes = [
                (
                    n.get("notebook"),
                    S.NoteInput.model_validate(
                        {
                            k: n[k]
                            for k in ("id", "title", "content", "document")
                            if k in n
                        }
                    ),
                )
                for n in data.get("notes", [])
            ]
            sources = data.get("sources", [])
            artifacts = data.get("artifacts", [])
            import re

            valid_id = lambda value: (
                isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value)
            )
            if any(not valid_id(n.id) for n in notebooks) or any(
                not valid_id(n.id) for _, n in notes
            ):
                raise ValueError("Backup records need valid IDs.")
            if any(nid not in ids for nid, _ in notes) or any(
                s.get("notebook") not in ids or not isinstance(s.get("text"), str)
                for s in sources
            ):
                raise ValueError("Backup has an invalid notebook reference.")
            for a in artifacts:
                if (
                    not valid_id(a.get("id"))
                    or not isinstance(a.get("notebook"), str)
                    or a.get("notebook") not in ids
                ):
                    raise ValueError(
                        "Artifacts need valid IDs and notebook references."
                    )
                if a.get("kind") not in ("quiz", "flashcards", "mindmap", "guide"):
                    raise ValueError(
                        "Artifact kind must be quiz, flashcards, mindmap, or guide."
                    )
            prepared_sources = []
            for source in sources:
                if (
                    not valid_id(source.get("id"))
                    or not isinstance(source.get("name"), str)
                    or not source["name"].strip()
                ):
                    raise ValueError("Source IDs and names are required.")
                text, chunks = extract(source["text"].encode(), "txt")
                prepared_sources.append((source, text, chunks))
        except Exception:
            raise HTTPException(
                422, "This backup has invalid records. Nothing was imported."
            ) from None
        for n in notebooks:
            if not repo.get(owner, "notebooks", n.id):
                repo.put(owner, "notebooks", {**n.model_dump(), "created_at": now()})
        for nid, note in notes:
            if not repo.get(owner, "notes", note.id):
                repo.put(
                    owner,
                    "notes",
                    {
                        **note.model_dump(exclude={"revision"}),
                        "notebook": nid,
                        "updated_at": now(),
                    },
                )
        for s, text, chunks in prepared_sources:
            sid = s.get("id")
            if not isinstance(sid, str) or not sid or len(sid) > 100:
                sid = hashlib.sha256(
                    (s["notebook"] + s["name"] + s["text"]).encode()
                ).hexdigest()
            if not repo.get(owner, "sources", sid):
                repo.put(
                    owner,
                    "sources",
                    {
                        "id": sid,
                        "notebook": s["notebook"],
                        "name": s.get("name", "Imported source"),
                        "type": s.get("type", "txt"),
                        "text": text,
                        "chunks": chunks,
                        "status": "ready",
                        "checksum": hashlib.sha256(text.encode()).hexdigest(),
                        "date": now(),
                        "imported": True,
                    },
                )
        for a in artifacts:
            if not repo.get(owner, "artifacts", a.get("id")):
                repo.put(
                    owner,
                    "artifacts",
                    {
                        **a,
                        "notebook": a["notebook"],
                        "updated_at": now(),
                    },
                )
        return workspace(owner)

    @app.get("/api/v1/notebooks")
    def notebooks(owner: Owner, q: str = ""):
        return [
            n
            for n in workspace(owner)["notebooks"]
            if q.casefold() in n["name"].casefold()
        ]

    @app.post("/api/v1/notebooks", status_code=201)
    def create_notebook(data: S.NotebookInput, owner: Owner):
        nid = data.id or identifier()
        if repo.get(owner, "notebooks", nid):
            raise HTTPException(409, "A notebook with this ID already exists.")
        return repo.put(
            owner,
            "notebooks",
            {**data.model_dump(), "id": nid, "created_at": now()},
            expected=0,
        )

    @app.patch("/api/v1/notebooks/{nid}")
    def rename_notebook(nid: str, data: S.NotebookInput, owner: Owner):
        current = notebook(owner, nid)
        return repo.put(
            owner, "notebooks", {**current, "name": data.name, "color": data.color}
        )

    @app.delete("/api/v1/notebooks/{nid}", status_code=202)
    def remove_notebook(nid: str, owner: Owner):
        current = notebook(owner, nid)
        repo.put(owner, "notebooks", {**current, "deleting": True})
        return service.enqueue(owner, "delete_notebook", notebook=nid)

    @app.post("/api/v1/notebooks/{nid}/sources", status_code=202)
    async def upload(nid: str, owner: Owner, file: UploadFile = File(...)):
        notebook(owner, nid)
        name = Path((file.filename or "document").replace("\\", "/")).name[:200]
        extension = name.rsplit(".", 1)[-1].lower()
        if extension not in ("pdf", "docx", "txt"):
            raise HTTPException(415, "Choose a PDF, DOCX or TXT document.")
        content = bytearray()
        while block := await file.read(64 * 1024):
            content.extend(block)
            if len(content) > service.settings.max_upload_bytes:
                raise HTTPException(413, "Files must be 10 MB or smaller.")
        if not content:
            raise HTTPException(400, "This file is empty.")
        checksum = hashlib.sha256(content).hexdigest()
        existing = next(
            (
                s
                for s in repo.list(owner, "sources")
                if s["notebook"] == nid and s.get("checksum") == checksum
            ),
            None,
        )
        if existing:
            return {"source": public_source(existing), "duplicate": True}
        sid = identifier()
        key = f"users/{owner}/sources/{sid}/original.{extension}"
        service.storage.put(
            key,
            bytes(content),
            {
                "pdf": "application/pdf",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "txt": "text/plain",
            }[extension],
        )
        source = repo.put(
            owner,
            "sources",
            {
                "id": sid,
                "notebook": nid,
                "name": name,
                "type": extension,
                "text": "",
                "date": now(),
                "status": "queued",
                "checksum": checksum,
                "storage_key": key,
            },
        )
        job = service.enqueue(owner, "ingest", notebook=nid, source_id=sid)
        return {"source": public_source(source), "job_id": job["id"]}

    @app.get("/api/v1/sources/{sid}/file")
    def original_source(sid: str, owner: Owner):
        source = owned(owner, "sources", sid)
        notebook(owner, source["notebook"])
        key = source.get("storage_key")
        if not key:
            raise HTTPException(
                404, "The original file is unavailable. Use the extracted text instead."
            )
        try:
            content = service.storage.get(key)
        except FileNotFoundError:
            raise HTTPException(404, "The original file is unavailable.") from None
        media_type = {
            "pdf": "application/pdf",
            "txt": "text/plain; charset=utf-8",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }.get(source["type"], "application/octet-stream")
        # Chunked transfer avoids a development-proxy stall on large binary
        # responses and does not require a browser request to a different origin.
        return StreamingResponse(
            (
                content[offset : offset + 64 * 1024]
                for offset in range(0, len(content), 64 * 1024)
            ),
            media_type=media_type,
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/v1/sources/{sid}/preview")
    def preview(sid: str, owner: Owner):
        source = owned(owner, "sources", sid)
        notebook(owner, source["notebook"])
        return {
            "id": sid,
            "name": source["name"],
            "text": source.get("text", ""),
            "chunks": source.get("chunks", []),
            "sections": reading_sections(source.get("chunks", [])),
            "ocr_pages": sorted(
                {c["page"] for c in source.get("chunks", []) if c.get("ocr")}
            ),
            "unreadable_pages": [
                c["page"] for c in source.get("chunks", []) if c.get("unreadable")
            ],
            "page_count": max(
                (c.get("page", 0) for c in source.get("chunks", [])), default=0
            ),
            "status": source["status"],
        }

    @app.patch("/api/v1/sources/{sid}")
    def rename_source(sid: str, data: S.Rename, owner: Owner):
        source = owned(owner, "sources", sid)
        return public_source(repo.put(owner, "sources", {**source, "name": data.name}))

    @app.delete("/api/v1/sources/{sid}", status_code=204)
    def remove_source(sid: str, owner: Owner):
        service.delete_source(owner, owned(owner, "sources", sid))
        return Response(status_code=204)

    @app.post("/api/v1/sources/{sid}/reprocess", status_code=202)
    def reprocess_source(sid: str, owner: Owner):
        source = owned(owner, "sources", sid)
        if not source.get("storage_key"):
            raise HTTPException(
                400, "The original upload is not available for reprocessing."
            )
        pending = next(
            (
                j
                for j in repo.list(owner, "jobs")
                if j["kind"] == "ingest"
                and j.get("source_id") == sid
                and j["status"] in ("queued", "processing")
            ),
            None,
        )
        if pending:
            return {"job_id": pending["id"]}
        repo.put(owner, "sources", {**source, "status": "queued", "error": None})
        job = service.enqueue(
            owner, "ingest", notebook=source["notebook"], source_id=sid
        )
        return {"job_id": job["id"]}

    @app.post("/api/v1/sources/{sid}/retry", status_code=202)
    def retry_source(sid: str, owner: Owner):
        source = owned(owner, "sources", sid)
        if source["status"] not in ("failed", "needs_ocr") or not source.get(
            "storage_key"
        ):
            raise HTTPException(
                409, "This source cannot be retried in its current state."
            )
        repo.put(owner, "sources", {**source, "status": "queued", "error": None})
        return service.enqueue(
            owner, "ingest", notebook=source["notebook"], source_id=sid
        )

    @app.get("/api/v1/jobs/{jid}")
    def job(jid: str, owner: Owner):
        return {k: v for k, v in owned(owner, "jobs", jid).items() if k != "checkpoint"}

    @app.get("/api/v1/notebooks/{nid}/jobs")
    def notebook_jobs(nid: str, owner: Owner):
        notebook(owner, nid)
        return [
            {k: v for k, v in j.items() if k != "checkpoint"}
            for j in repo.list(owner, "jobs")
            if j.get("notebook") == nid
        ]

    @app.post("/api/v1/jobs/{jid}/retry", status_code=202)
    def retry_job(jid: str, owner: Owner):
        job = owned(owner, "jobs", jid)
        if job["status"] != "failed":
            raise HTTPException(409, "Only failed jobs can be retried.")
        job = repo.put(owner, "jobs", {**job, "status": "queued", "error": None})
        if service.settings.redis_url:
            from .tasks import celery_app

            celery_app.send_task("cdmento.run_job", args=[owner, jid])
        return job

    @app.post("/api/v1/notebooks/{nid}/notes", status_code=201)
    def create_note(nid: str, data: S.NoteInput, owner: Owner):
        notebook(owner, nid)
        return repo.put(
            owner,
            "notes",
            {
                **data.model_dump(exclude={"revision"}),
                "id": data.id or identifier(),
                "notebook": nid,
                "updated_at": now(),
            },
            expected=0,
        )

    @app.patch("/api/v1/notes/{note_id}")
    def update_note(note_id: str, data: S.NoteInput, owner: Owner):
        current = owned(owner, "notes", note_id)
        notebook(owner, current["notebook"])
        if data.revision is None:
            raise HTTPException(422, "Include the note revision when saving.")
        return repo.put(
            owner,
            "notes",
            {
                **current,
                **data.model_dump(exclude={"id", "revision"}),
                "updated_at": now(),
            },
            expected=data.revision,
        )

    @app.delete("/api/v1/notes/{note_id}", status_code=204)
    def delete_note(note_id: str, owner: Owner):
        owned(owner, "notes", note_id)
        repo.delete(owner, "notes", note_id)
        return Response(status_code=204)

    @app.get("/api/v1/notebooks/{nid}/conversation")
    def conversation(nid: str, owner: Owner):
        notebook(owner, nid)
        return repo.get(owner, "conversations", nid) or {
            "id": nid,
            "notebook": nid,
            "messages": [],
        }

    @app.post("/api/v1/notebooks/{nid}/messages")
    def chat(nid: str, data: S.ChatInput, owner: Owner):
        sources = selected(owner, nid, data.source_ids)
        ai_ready(owner)
        with locks[(owner, nid, "chat")]:
            pending = next(
                (
                    j
                    for j in repo.list(owner, "jobs")
                    if j["kind"] == "chat"
                    and j.get("notebook") == nid
                    and j["status"] in ("queued", "processing", "waiting")
                ),
                None,
            )
            if pending:
                if pending["question"] != data.question or set(
                    pending["source_ids"]
                ) != {s["id"] for s in sources}:
                    raise HTTPException(
                        409,
                        "A previous question is waiting for free quota. Finish it before sending another.",
                    )
                return JSONResponse(
                    {
                        "job_id": pending["id"],
                        "queued": True,
                        "retry_at": pending.get("retry_at"),
                        "error": pending.get("error"),
                        "kind": "quota",
                    },
                    status_code=202,
                )
            history = conversation(nid, owner)
            try:
                result = service.ai_for(owner).answer(
                    {
                        **notebook(owner, nid),
                        "conversation_summary": history.get("summary", ""),
                    },
                    sources,
                    data.question.strip(),
                    history["messages"],
                )
            except AIUnavailable as error:
                job = service.enqueue(
                    owner,
                    "chat",
                    notebook=nid,
                    source_ids=[s["id"] for s in sources],
                    question=data.question,
                    status="waiting",
                    retry_at=time.time() + error.retry_after,
                    error=str(error),
                )
                return JSONResponse(
                    {
                        "job_id": job["id"],
                        "queued": True,
                        "retry_at": job["retry_at"],
                        "error": str(error),
                        "kind": "quota",
                    },
                    status_code=202,
                )
            except AIRefused as error:
                raise HTTPException(
                    422, {"error": str(error), "kind": "refused"}
                ) from None
            except ValueError as error:
                kind = (
                    "permission"
                    if "permission" in str(error).lower()
                    else "invalid_response"
                )
                raise HTTPException(422, {"error": str(error), "kind": kind}) from None
            except Exception:
                raise HTTPException(
                    502,
                    {
                        "error": "The AI provider could not answer. Check the connection and try again.",
                        "kind": "connection",
                    },
                ) from None
            return service.save_answer(owner, nid, data.question, result, history)

    @app.post("/api/v1/notebooks/{nid}/generations", status_code=202)
    def generate(nid: str, data: S.GenerationInput, owner: Owner):
        sources = selected(owner, nid, data.source_ids)
        ai_ready(owner)
        if data.pages is not None:
            if len(sources) != 1 or sources[0]["type"] != "pdf":
                raise HTTPException(400, "Page ranges apply to one selected PDF.")
            max_page = max(
                (c.get("page", 0) for c in sources[0].get("chunks", [])), default=0
            )
            if any(p > max_page for p in data.pages):
                raise HTTPException(400, "The page selection exceeds this PDF.")
        if data.kind == "guide":
            from .ai import source_units

            units = source_units(sources, data.pages)
            if not units:
                raise HTTPException(400, "No readable text in the selected coverage.")
            if sum(len(u["text"]) for u in units) > 64000:
                raise HTTPException(
                    400,
                    "Choose a smaller chapter or page range (up to about 64,000 text characters).",
                )
        request = data.model_dump()
        key = service.cache_key(request, sources)
        existing = next(
            (a for a in repo.list(owner, "artifacts") if a.get("cache_key") == key),
            None,
        )
        if existing:
            return {"artifact_id": existing["id"], "cached": True}
        outstanding = [
            j
            for j in repo.list(owner, "jobs")
            if j.get("cache_key") == key
            and j["status"] in ("queued", "processing", "waiting")
        ]
        if outstanding:
            return {
                "job_id": outstanding[0]["id"],
                "artifact_id": outstanding[0]["artifact_id"],
            }
        if (
            sum(
                j["status"] in ("queued", "processing", "waiting")
                for j in repo.list(owner, "jobs")
            )
            >= 5
        ):
            raise HTTPException(
                429, "Finish your current processing jobs before starting more."
            )
        artifact_id = identifier()
        job = service.enqueue(
            owner,
            "generate",
            notebook=nid,
            source_ids=[s["id"] for s in sources],
            request=request,
            cache_key=key,
            artifact_id=artifact_id,
        )
        return {"job_id": job["id"], "artifact_id": artifact_id}

    @app.post("/api/v1/artifacts/{aid}/save-note", status_code=201)
    def save_reviewer_note(aid: str, owner: Owner):
        artifact = owned(owner, "artifacts", aid)
        if artifact["kind"] != "guide":
            raise HTTPException(400, "Choose a saved reviewer.")
        for note in repo.list(owner, "notes"):
            if note.get("reviewer_id") == aid:
                return note
        paragraphs = [artifact.get("overview", "")]
        for section in artifact.get("sections", []):
            paragraphs.extend([section["heading"], section["content"]])
            paragraphs.extend(
                f"Source {c['source_id']} · "
                + (
                    f"page {c['page']}"
                    if c.get("page")
                    else f"section {c.get('section', 1)}"
                )
                + f": {c['quote']}"
                for c in section["citations"]
            )
        for question in artifact.get("practice_questions", []):
            paragraphs.extend([question["question"], question["answer"]])
        paragraphs.extend(artifact.get("warnings", []))
        document = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]}
                for text in paragraphs
                if text
            ],
        }
        if len(json.dumps(document)) > 200000:
            raise HTTPException(
                400,
                "This reviewer is too large for one note. Keep it in Sources or copy individual sections.",
            )
        return repo.put(
            owner,
            "notes",
            {
                "id": identifier(),
                "notebook": artifact["notebook"],
                "title": artifact.get("title", "Study reviewer"),
                "content": "",
                "document": document,
                "reviewer_id": aid,
                "updated_at": now(),
            },
        )

    @app.get("/api/v1/notebooks/{nid}/artifacts")
    def artifacts(nid: str, owner: Owner, kind: str = ""):
        notebook(owner, nid)
        return [
            public_artifact(a)
            for a in repo.list(owner, "artifacts")
            if a["notebook"] == nid and (not kind or a["kind"] == kind)
        ]

    @app.get("/api/v1/artifacts/{aid}")
    def artifact(aid: str, owner: Owner):
        return public_artifact(owned(owner, "artifacts", aid))

    @app.patch("/api/v1/decks/{aid}/cards/{cid}")
    def update_card(aid: str, cid: str, data: S.CardUpdate, owner: Owner):
        deck = owned(owner, "artifacts", aid)
        if deck["kind"] != "flashcards" or cid not in {c["id"] for c in deck["cards"]}:
            raise HTTPException(404, "Card not found.")
        card = next(c for c in deck["cards"] if c["id"] == cid)
        if (card["question"], card["answer"]) != (data.question, data.answer):
            card.pop("schedule", None)
        card.update(data.model_dump())
        if card["accepted"] and not card.get("schedule"):
            card["schedule"] = Card().to_json()
        repo.put(owner, "artifacts", deck, expected=deck["revision"])
        return card

    @app.post("/api/v1/decks/{aid}/cards/{cid}/reviews")
    def review_card(aid: str, cid: str, data: S.ReviewInput, owner: Owner):
        with locks[(owner, cid)]:
            event = repo.get(owner, "reviews", data.event_id)
            if event:
                if event["card_id"] != cid:
                    raise HTTPException(409, "This review event ID was already used.")
                return event
            deck = owned(owner, "artifacts", aid)
            card = next((c for c in deck.get("cards", []) if c["id"] == cid), None)
            if not card or not card.get("accepted"):
                raise HTTPException(409, "Accept this card before scheduled review.")
            if data.event_id in card.get("review_receipts", {}):
                return card["review_receipts"][data.event_id]
            schedule = Card.from_json(card["schedule"])
            updated, log = Scheduler().review_card(
                schedule, Rating(1 if data.assisted else data.rating)
            )
            card["schedule"] = updated.to_json()
            receipt = {
                "id": data.event_id,
                "notebook": deck["notebook"],
                "deck_id": aid,
                "card_id": cid,
                "rating": data.rating,
                "assisted": data.assisted,
                "due": updated.due.isoformat(),
                "log": log.to_json(),
                "created_at": now(),
            }
            card["review_receipts"] = {
                **dict(list(card.get("review_receipts", {}).items())[-19:]),
                data.event_id: receipt,
            }
            repo.put(owner, "artifacts", deck, expected=deck["revision"])
            return repo.put(owner, "reviews", receipt)

    @app.delete("/api/v1/decks/{aid}/cards/{cid}", status_code=204)
    def discard_card(aid: str, cid: str, owner: Owner):
        deck = owned(owner, "artifacts", aid)
        card = next((c for c in deck.get("cards", []) if c["id"] == cid), None)
        if not card:
            raise HTTPException(404, "Card not found.")
        if card.get("accepted"):
            raise HTTPException(409, "Only draft cards can be discarded here.")
        deck["cards"] = [c for c in deck["cards"] if c["id"] != cid]
        repo.put(owner, "artifacts", deck, expected=deck["revision"])
        return Response(status_code=204)

    @app.post("/api/v1/quizzes/{aid}/attempts", status_code=201)
    def start_attempt(aid: str, data: S.AttemptInput, owner: Owner):
        quiz = owned(owner, "artifacts", aid)
        if quiz["kind"] != "quiz":
            raise HTTPException(404, "Quiz not found.")
        attempt = repo.put(
            owner,
            "attempts",
            {
                "id": identifier(),
                "notebook": quiz["notebook"],
                "artifact_id": aid,
                "mode": data.mode,
                "status": "active",
                "questions": copy.deepcopy(quiz["questions"]),
                "created_at": now(),
            },
        )
        public = copy.deepcopy(attempt)
        for question in public["questions"]:
            question.pop("correct", None)
            question.pop("explanation", None)
        return public

    @app.post("/api/v1/attempts/{attempt_id}/submit")
    def submit(attempt_id: str, data: S.Submission, owner: Owner):
        with locks[(owner, attempt_id)]:
            attempt = owned(owner, "attempts", attempt_id)
            if attempt["status"] == "completed":
                return attempt["result"]
            questions = attempt["questions"]
            if set(data.answers) != {q["id"] for q in questions} or any(
                data.answers[q["id"]] not in {o["id"] for o in q["options"]}
                for q in questions
            ):
                raise HTTPException(
                    422, "Submit one valid option ID for every question."
                )
            results = [
                {
                    **q,
                    "selected": data.answers[q["id"]],
                    "is_correct": data.answers[q["id"]] == q["correct"],
                }
                for q in questions
            ]
            result = {
                "score": sum(q["is_correct"] for q in results),
                "total": len(results),
                "questions": results,
                "weak_concepts": list(
                    dict.fromkeys(q["concept"] for q in results if not q["is_correct"])
                ),
            }
            repo.put(
                owner,
                "attempts",
                {
                    **attempt,
                    "status": "completed",
                    "result": result,
                    "submitted_at": now(),
                },
                expected=attempt["revision"],
            )
            return result

    @app.post("/api/v1/attempts/{attempt_id}/check")
    def check_practice(attempt_id: str, data: S.PracticeCheck, owner: Owner):
        attempt = owned(owner, "attempts", attempt_id)
        if attempt["mode"] != "practice" or attempt["status"] != "active":
            raise HTTPException(
                403, "Immediate feedback is available only during practice."
            )
        question = next(
            (q for q in attempt["questions"] if q["id"] == data.question_id), None
        )
        if not question or data.option_id not in {o["id"] for o in question["options"]}:
            raise HTTPException(422, "Choose a valid answer for this question.")
        return {
            "is_correct": question["correct"] == data.option_id,
            "explanation": question["explanation"],
            "source_ids": question["source_ids"],
        }

    @app.get("/api/v1/notebooks/{nid}/mind-map")
    def get_map(nid: str, owner: Owner):
        notebook(owner, nid)
        return repo.get(owner, "maps", nid) or {
            "id": nid,
            "notebook": nid,
            "nodes": [],
            "edges": [],
            "viewport": None,
            "revision": 0,
        }

    @app.put("/api/v1/notebooks/{nid}/mind-map")
    def save_map(nid: str, data: S.GraphInput, owner: Owner):
        notebook(owner, nid)
        ids = [n.get("id") for n in data.nodes]
        if (
            any(not isinstance(x, str) or not x for x in ids)
            or len(set(ids)) != len(ids)
            or any(
                e.get("source") not in ids or e.get("target") not in ids
                for e in data.edges
            )
        ):
            raise HTTPException(422, "Map nodes and connections must have valid IDs.")
        if len(json.dumps(data.model_dump())) > 200_000:
            raise HTTPException(413, "This map is too large.")
        return repo.put(
            owner,
            "maps",
            {**data.model_dump(exclude={"revision"}), "id": nid, "notebook": nid},
            expected=data.revision,
        )

    @app.get("/api/v1/focus-sessions/current")
    def current_focus(owner: Owner):
        sessions = [
            s
            for s in repo.list(owner, "focus_sessions")
            if s["status"] in ("running", "paused")
        ]
        return sessions[-1] if sessions else None

    @app.post("/api/v1/focus-sessions", status_code=201)
    def start_focus(data: S.FocusInput, owner: Owner):
        if data.notebook:
            notebook(owner, data.notebook)
        with locks[(owner, "focus")]:
            if current_focus(owner):
                raise HTTPException(
                    409, "Pause, finish or cancel your current session first."
                )
            return repo.put(
                owner,
                "focus_sessions",
                {
                    "id": identifier(),
                    **data.model_dump(),
                    "status": "running",
                    "remaining": data.duration,
                    "deadline": (
                        datetime.now(timezone.utc) + timedelta(seconds=data.duration)
                    ).isoformat(),
                    "started_at": now(),
                },
            )

    @app.patch("/api/v1/focus-sessions/{fid}")
    def focus_action(fid: str, data: S.FocusAction, owner: Owner):
        session = owned(owner, "focus_sessions", fid)
        if session["status"] not in ("running", "paused"):
            return session
        remaining = (
            max(
                0,
                round(
                    (
                        datetime.fromisoformat(session["deadline"])
                        - datetime.now(timezone.utc)
                    ).total_seconds()
                ),
            )
            if session["status"] == "running"
            else session["remaining"]
        )
        if data.action == "pause":
            session.update(status="paused", remaining=remaining)
        elif data.action == "resume":
            session.update(
                status="running",
                deadline=(
                    datetime.now(timezone.utc) + timedelta(seconds=remaining)
                ).isoformat(),
            )
        else:
            if data.action == "complete" and remaining > 1:
                raise HTTPException(409, "This session is still in progress.")
            session.update(
                status="completed" if data.action == "complete" else "cancelled",
                remaining=remaining,
                finished_at=now(),
            )
        return repo.put(owner, "focus_sessions", session, expected=session["revision"])

    @app.get("/api/v1/tasks")
    def tasks(owner: Owner):
        return repo.list(owner, "tasks")

    @app.post("/api/v1/tasks", status_code=201)
    def create_task(data: S.TaskInput, owner: Owner):
        return repo.put(
            owner,
            "tasks",
            {"id": identifier(), **data.model_dump(), "created_at": now()},
        )

    @app.patch("/api/v1/tasks/{tid}")
    def update_task(tid: str, data: S.TaskInput, owner: Owner):
        return repo.put(
            owner, "tasks", {**owned(owner, "tasks", tid), **data.model_dump()}
        )

    @app.delete("/api/v1/tasks/{tid}", status_code=204)
    def delete_task(tid: str, owner: Owner):
        owned(owner, "tasks", tid)
        repo.delete(owner, "tasks", tid)
        return Response(status_code=204)

    # --- Manual flashcard deck creation (no AI required) ---

    @app.post("/api/v1/notebooks/{nid}/decks", status_code=201)
    def create_deck(nid: str, data: S.ManualDeckInput, owner: Owner):
        notebook(owner, nid)
        cards = [
            {
                "id": identifier(),
                "question": c.question,
                "answer": c.answer,
                "concept": c.concept,
                "source_ids": [],
                "accepted": False,
            }
            for c in data.cards
        ]
        return repo.put(
            owner,
            "artifacts",
            {
                "id": identifier(),
                "notebook": nid,
                "kind": "flashcards",
                "title": data.title,
                "cards": cards,
                "created_at": now(),
                "source_ids": [],
                "revision": 1,
            },
            expected=0,
        )

    @app.post("/api/v1/decks/{aid}/cards", status_code=201)
    def add_card(aid: str, data: S.ManualCardInput, owner: Owner):
        deck = owned(owner, "artifacts", aid)
        if deck["kind"] != "flashcards":
            raise HTTPException(400, "Not a flashcard deck.")
        card = {
            "id": identifier(),
            "question": data.question,
            "answer": data.answer,
            "concept": data.concept,
            "source_ids": [],
            "accepted": False,
        }
        deck["cards"] = [*deck.get("cards", []), card]
        return repo.put(
            owner,
            "artifacts",
            {**deck, "revision": deck.get("revision", 0) + 1},
            expected=deck.get("revision", 0),
        )

    # --- Manual quiz creation (no AI required) ---

    @app.post("/api/v1/notebooks/{nid}/quizzes", status_code=201)
    def create_quiz(nid: str, data: S.ManualQuizInput, owner: Owner):
        notebook(owner, nid)
        questions = [
            {
                "id": identifier(),
                "question": q.question,
                "options": [
                    {"id": str(i), "text": text} for i, text in enumerate(q.options)
                ],
                "correct": str(q.correct),
                "explanation": q.explanation,
                "concept": q.concept,
                "source_ids": [],
            }
            for q in data.questions
        ]
        return repo.put(
            owner,
            "artifacts",
            {
                "id": identifier(),
                "notebook": nid,
                "kind": "quiz",
                "title": data.title,
                "questions": questions,
                "created_at": now(),
                "source_ids": [],
                "revision": 1,
            },
            expected=0,
        )

    @app.post("/api/v1/quizzes/{aid}/questions", status_code=201)
    def add_quiz_question(aid: str, data: S.ManualQuestionInput, owner: Owner):
        quiz = owned(owner, "artifacts", aid)
        if quiz["kind"] != "quiz":
            raise HTTPException(400, "Not a quiz.")
        options = [{"id": str(i), "text": text} for i, text in enumerate(data.options)]
        question = {
            "id": identifier(),
            "question": data.question,
            "options": options,
            "correct": str(data.correct),
            "explanation": data.explanation,
            "concept": data.concept,
            "source_ids": [],
        }
        quiz["questions"] = [*quiz.get("questions", []), question]
        return repo.put(
            owner,
            "artifacts",
            {**quiz, "revision": quiz.get("revision", 0) + 1},
            expected=quiz.get("revision", 0),
        )

    return app


app = create_app()
