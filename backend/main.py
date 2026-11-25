import truststore

truststore.inject_into_ssl()

import copy
import hashlib
import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fsrs import Scheduler, Card, Rating
from .config import settings
from .repository import Repository, FirestoreRepository, Conflict
from .storage import FileStorage
from .ai import AIService, extractive_brief
from .services import Services, now, identifier
from . import schemas as S
from .demo_auth import DemoAuth
from .google_auth import GoogleAuth
from .password_auth import PasswordAuth
from .brevo import BrevoMailer
from .documents import reading_sections
from .scholar import DEFAULT_EVIDENCE_SOURCES, ScholarSearch
from .providers.gateway import AIUnavailable, AIRefused


def create_services(config):
    config.validate_modes()
    bucket = None
    if config.auth_mode == "firebase" or config.data_backend == "firestore":
        import firebase_admin
        from firebase_admin import firestore, storage
        from firebase_admin import credentials

        try:
            firebase_admin.get_app()
        except ValueError:
            credential = None
            if config.firebase_service_account_json:
                credential = credentials.Certificate(
                    json.loads(config.firebase_service_account_json)
                )
            firebase_admin.initialize_app(
                credential=credential,
                options={
                    "projectId": config.firebase_project_id or None,
                    "storageBucket": config.firebase_storage_bucket or None,
                },
            )
        if config.data_backend == "firestore":
            if config.firebase_storage_bucket:
                bucket = storage.bucket()
            repo = FirestoreRepository(firestore.client(), bucket)
        else:
            repo = Repository(config.data_dir)
    else:
        repo = Repository(config.data_dir)
    return Services(
        config,
        repo,
        FileStorage(
            config.data_dir,
            bucket,
            use_vercel_blob=config.data_backend == "firestore",
        ),
        AIService(config, repo),
    )


def user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        HTTPBearer(auto_error=False)
    ),
):
    config = request.app.state.services.settings
    authorization = request.headers.get("authorization", "")
    token = (
        credentials.credentials
        if isinstance(credentials, HTTPAuthorizationCredentials)
        else authorization[7:]
        if authorization.startswith("Bearer ")
        else ""
    )
    if config.auth_mode == "local":
        if request.client and request.client.host not in (
            "127.0.0.1",
            "::1",
            "testclient",
        ):
            raise HTTPException(403, "Local mode only accepts loopback connections.")
        if authorization:
            if not authorization.startswith("Bearer "):
                raise HTTPException(401, "Sign in to your demo account again.")
            return request.app.state.demo_auth.resolve(token)
        return "local-workspace"
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in to your account to continue.")
    if config.auth_mode == "google":
        session_token = token
        if session_token.startswith("account_"):
            claims = request.app.state.password_auth.resolve(session_token)
        else:
            claims = request.app.state.google_auth.resolve(session_token)
        request.state.account_claims = claims
        return claims["uid"]
    try:
        from firebase_admin import auth

        claims = auth.verify_id_token(token, check_revoked=True)
    except Exception:
        raise HTTPException(
            401, "Your session expired. Please sign in again."
        ) from None
    if not claims.get("email_verified"):
        raise HTTPException(403, "Verify your email before opening your workspace.")
    request.state.account_claims = claims
    return claims["uid"]


Owner = Annotated[str, Depends(user)]


def check_admin(request: Request, owner: Owner):
    claims = getattr(request.state, "account_claims", {}) or {}
    email = (claims.get("email") or "").strip().casefold()
    if not email and owner == "demo-student":
        email = "demo@cdmento.local"
    settings_obj = getattr(request.app.state.services, "settings", settings)
    admin_emails = [
        e.strip().casefold()
        for e in getattr(settings_obj, "admin_emails", "").split(",")
        if e.strip()
    ]
    repo = request.app.state.services.repo
    profile = repo.get(owner, "profile", "account") or {}
    if (
        claims.get("admin") is True
        or claims.get("role") == "admin"
        or (email and email in admin_emails)
        or profile.get("role") == "admin"
        or owner == "demo-student"
    ):
        return owner
    raise HTTPException(status_code=403, detail="Admin access required.")


AdminOwner = Annotated[str, Depends(check_admin)]



def create_app(config=None, services=None):
    service = services or create_services(config or settings)
    repo = service.repo
    locks = defaultdict(threading.RLock)
    requests = defaultdict(deque)
    searches = defaultdict(deque)
    briefs = defaultdict(deque)

    @asynccontextmanager
    async def lifespan(app):
        service.start()
        yield
        service.stop.set()
        if service.worker:
            service.worker.join(timeout=3)

    api_tags = [
        {"name": "Diagnostics", "description": "Health and service readiness checks."},
        {"name": "Authentication", "description": "Sign-in, account verification, and session endpoints."},
        {"name": "Profile", "description": "Current account and profile settings."},
        {"name": "Workspace", "description": "Workspace data and backup import/export."},
        {"name": "Notebooks", "description": "Notebook creation and management."},
        {"name": "Sources", "description": "Source uploads, extracted content, and processing."},
        {"name": "Jobs", "description": "Background job status and retries."},
        {"name": "Notes", "description": "Personal notes and reviewer export."},
        {"name": "Study Tools", "description": "AI generation, chat, flashcards, quizzes, and mind maps."},
        {"name": "Focus", "description": "Focus sessions and study tasks."},
        {"name": "Feedback", "description": "Feedback submitted by workspace users."},
        {"name": "Admin", "description": "Administrative users, activity, support, and system operations."},
    ]
    app = FastAPI(
        title="CdMento — A Place to Understand",
        description=(
            "Welcome to the CdMento backend API. CdMento helps students make "
            "course material easier to understand through organized sources, "
            "clear notes, AI-powered study tools, and focused practice. "
            "Use these endpoints to connect the CdMento app with its workspace, "
            "learning, and account services."
        ),
        version="1.0.0",
        lifespan=lifespan,
        openapi_tags=api_tags,
    )
    app.state.services = service
    app.state.scholar = ScholarSearch(service.settings.semantic_scholar_api_key)
    app.state.demo_auth = DemoAuth(repo)
    app.state.google_auth = GoogleAuth(repo, service.settings.google_client_id)
    app.state.brevo_mailer = BrevoMailer(
        service.settings.brevo_api_key,
        service.settings.brevo_sender_email,
        service.settings.brevo_sender_name,
    )
    app.state.password_auth = PasswordAuth(
        repo, app.state.brevo_mailer, service.settings.app_base_url
    )
    if service.settings.auth_mode == "local":
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=["127.0.0.1", "localhost", "testserver", "[::1]"],
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://cdmento-study-7.vercel.app",
            "https://cdmento-study-7.vercel.app",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        max_age=3600,
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
        logging.getLogger("cdmento").exception(
            "Unhandled error for %s %s", request.method, request.url.path
        )
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

    @app.get("/api/v1/search/{source}")
    def search_proxy(source: str, query: str, request: Request, owner: Owner):
        scholar = request.app.state.scholar
        if source not in scholar.sources:
            raise HTTPException(404, "Unknown search source.")
        with locks["limits"]:
            queue = searches[owner]
            while queue and queue[0] < time.time() - 60:
                queue.popleft()
            if len(queue) >= 30:
                raise HTTPException(
                    429,
                    {
                        "error": "Please wait a minute before running more searches.",
                        "kind": "rate_limit",
                    },
                )
            queue.append(time.time())
        try:
            body, media_type = scholar.fetch(source, query)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        except Exception:
            raise HTTPException(
                502,
                {
                    "error": "This source is unavailable right now.",
                    "kind": "unavailable",
                },
            ) from None
        return Response(content=body, media_type=media_type)

    @app.post("/api/v1/search/brief")
    def search_brief(data: S.SearchBriefInput, request: Request, owner: Owner):
        scholar = request.app.state.scholar
        chosen = [
            source
            for source in (data.sources or list(DEFAULT_EVIDENCE_SOURCES))
            if source in scholar.evidence_sources
        ]
        if not chosen:
            raise HTTPException(400, "Choose at least one known search source.")
        with locks["limits"]:
            queue = briefs[owner]
            while queue and queue[0] < time.time() - 3600:
                queue.popleft()
            if len(queue) >= 10:
                raise HTTPException(
                    429,
                    {
                        "error": "You can create 10 topic briefs per hour. Please try again later.",
                        "kind": "rate_limit",
                        "retry_after": max(1, int(queue[0] + 3600 - time.time())),
                    },
                )
            queue.append(time.time())
        key = hashlib.sha256(
            f"{data.query.casefold()}|{','.join(chosen)}|{data.sort}".encode()
        ).hexdigest()
        cached = repo.get(owner, "search_cache", key)
        if (
            cached
            and cached.get("expires_at", 0) > time.time()
            and cached.get("body")
        ):
            return {**cached["body"], "cached": True}
        try:
            result = scholar.evidence(data.query, chosen, data.sort)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        except Exception:
            raise HTTPException(
                502,
                {
                    "error": "Search sources are unavailable right now.",
                    "kind": "unavailable",
                },
            ) from None
        evidence = result["evidence"]
        brief, support, ai_info = None, "general", None
        topic_brief = getattr(service.ai, "topic_brief", None)
        if topic_brief:
            try:
                generated = topic_brief(data.query, evidence)
                brief = generated["brief"]
                support = generated["support"]
                ai_info = generated.get("_ai")
            except Exception:
                brief = None
        if brief is None and evidence:
            brief = extractive_brief(data.query, evidence)
            support = "evidence-only"
        if brief is None:
            raise HTTPException(
                503,
                {
                    "error": "No sources were found and the AI overview is unavailable. Try another topic or source.",
                    "kind": "connection",
                },
            )
        body = {
            "query": data.query,
            "brief": brief,
            "evidence": evidence,
            "coverage": result["coverage"],
            "support": support,
            "cached": False,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        if ai_info:
            body["ai"] = ai_info
        try:
            repo.put(
                owner,
                "search_cache",
                {"id": key, "expires_at": time.time() + 86400, "body": body},
            )
        except Exception:
            # A cache write failure must never break a successful brief.
            pass
        return body

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

    def public_attempt(value):
        """Strip quiz answer keys and explanations from stored attempts.

        A stored attempt can embed the full question list with correct answers
        and explanations. Returning it verbatim would leak the answer key
        through the workspace export, so sanitize it the same way as artifacts.
        """
        value = copy.deepcopy(value)
        for question in value.get("questions", []):
            for key in ("correct", "explanation"):
                question.pop(key, None)
        return value

    @app.get("/api/v1/health")
    def health(request: Request, deep: int = 0):
        result = {
            "status": "ok",
            "backend": "python",
            "auth_mode": service.settings.auth_mode,
            "data_backend": service.settings.data_backend,
            "ai_configured": getattr(service.ai, "configured", False),
            "demo_account_available": service.settings.auth_mode == "local"
            and app.state.demo_auth.available(),
            "email_configured": app.state.brevo_mailer.configured,
        }
        if not deep:
            return result
        # Deep checks perform a repository write and an outbound certificate
        # fetch. Require an authenticated caller so the probe cannot be used
        # anonymously for write amplification or outbound probing.
        user(request)
        checks = {}

        def probe(name, action):
            try:
                action()
                checks[name] = "ok"
            except Exception as error:
                checks[name] = f"{type(error).__name__}: {error}"

        probe("repo_read", lambda: repo.list("diagnostics", "probe"))

        def repo_write():
            record = repo.put("diagnostics", "probe", {"id": "check", "at": time.time()})
            repo.delete("diagnostics", "probe", record["id"])

        probe("repo_write", repo_write)

        def google_certs():
            from google.auth.transport.requests import Request

            Request()(url="https://www.googleapis.com/oauth2/v3/certs")

        probe("google_certs", google_certs)
        checks["google_client_id"] = (
            "set" if service.settings.google_client_id else "missing"
        )
        result["status"] = (
            "ok"
            if all(value == "ok" for key, value in checks.items() if key != "google_client_id")
            else "degraded"
        )
        result["checks"] = checks
        return result

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

    def record_access_log(email: str, auth_method: str, status: str, ip: str, role: str = "student"):
        try:
            admin_emails = [
                e.strip().casefold()
                for e in getattr(service.settings, "admin_emails", "").split(",")
                if e.strip()
            ]
            if email.strip().casefold() in admin_emails or email == "demo@cdmento.local":
                role = "admin"
            repo.put(
                "__system_admin__",
                "access_logs",
                {
                    "id": identifier(),
                    "email": email,
                    "role": role,
                    "auth_method": auth_method,
                    "status": status,
                    "ip": ip or "127.0.0.1",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            pass

    def record_activity(owner, action, target, metadata="", request=None):
        """Record real user actions for the admin audit feed."""
        try:
            claims = getattr(request.state, "account_claims", {}) if request else {}
            email = (claims.get("email") or "").strip().casefold()
            if not email:
                profile = repo.get(owner, "profile", "account") or {}
                email = profile.get("email", owner)
            repo.put(
                "__system_admin__",
                "activity_logs",
                {
                    "id": identifier(),
                    "uid": owner,
                    "user": email,
                    "action": action,
                    "target": target,
                    "metadata": metadata,
                    "timestamp": now(),
                },
            )
        except Exception:
            logging.getLogger("cdmento").exception("Failed to record activity for %s", owner)

    def upsert_user_profile(
        uid,
        email,
        display_name,
        provider,
        claims=None,
        preserve_display_name=False,
        email_verified=None,
        mark_sign_in=True,
    ):
        """Keep the admin-facing account profile in sync after authentication."""
        if not uid:
            return None
        claims = claims or {}
        email = (email or "").strip().casefold()
        previous = repo.get(uid, "profile", "account") or {}
        admin_emails = {
            value.strip().casefold()
            for value in getattr(service.settings, "admin_emails", "").split(",")
            if value.strip()
        }
        custom_claims = claims.get("admin") is True
        role = previous.get("role", "student")
        if email in admin_emails or custom_claims:
            role = "admin"
        return repo.put(
            uid,
            "profile",
            {
                **previous,
                "id": "account",
                "email": email,
                "display_name": previous.get("display_name") if preserve_display_name and previous.get("display_name") else (display_name or previous.get("display_name") or email.split("@", 1)[0]),
                "provider": provider,
                "role": role,
                "email_verified": previous.get("email_verified", False) if email_verified is None else bool(email_verified),
                "created_at": previous.get("created_at", now()),
                "last_sign_in_at": now() if mark_sign_in else previous.get("last_sign_in_at"),
                "updated_at": now(),
            },
        )

    def _iso_timestamp(value):
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.astimezone(timezone.utc).isoformat()
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()

    def _account_timestamp(value):
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        return value

    def _profile_records(warnings):
        """Every account profile, whichever sign-in method created it."""
        if isinstance(repo, FirestoreRepository):
            records = {}
            try:
                for snapshot in repo.db.collection("users").stream():
                    value = repo.decode(snapshot.to_dict()) or {}
                    if value:
                        records[snapshot.id] = value
            except Exception as error:
                detail = f"{type(error).__name__}: {error}"
                logging.getLogger("cdmento").exception(
                    "Listing user profile roots failed: %s", detail
                )
                warnings.append(f"Listing user profiles failed ({detail}).")
            try:
                for snapshot in repo.db.collection_group("profile").stream():
                    owner_ref = snapshot.reference.parent.parent
                    if owner_ref is None:
                        continue
                    records[owner_ref.id] = {
                        **records.get(owner_ref.id, {}),
                        **(repo.decode(snapshot.to_dict()) or {}),
                    }
            except Exception as error:
                detail = f"{type(error).__name__}: {error}"
                logging.getLogger("cdmento").exception(
                    "Listing account profiles failed: %s", detail
                )
                warnings.append(f"Listing account profiles failed ({detail}).")
            return records
        with repo.connection() as db:
            rows = db.execute(
                "SELECT owner, body FROM records WHERE kind='profile'"
            ).fetchall()
        # Owner keys such as "__system_admin__" are bookkeeping, not people.
        return {
            owner: json.loads(body)
            for owner, body in rows
            if not owner.startswith("__")
        }

    def _firebase_auth_users(warnings):
        """Firebase Auth users, or a recorded error instead of a silent gap.

        Custom Google/email accounts live in the CdMento auth collections, so a
        Firebase failure must never abort the whole listing.
        """
        # Only query Firebase Auth when it is the configured identity provider.
        # Google/email deployments keep their accounts in the custom auth
        # collections, so calling Identity Toolkit there would always fail
        # with a misleading API-not-enabled warning.
        if service.settings.auth_mode != "firebase":
            return []
        try:
            from firebase_admin import auth

            return list(auth.list_users().iterate_all())
        except Exception as error:
            detail = f"{type(error).__name__}: {error}"
            logging.getLogger("cdmento").exception(
                "Firebase Admin user listing failed: %s", detail
            )
            warnings.append(
                "Firebase Auth listing failed ("
                + detail
                + "). Check FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PROJECT_ID, "
                "and that the Identity Toolkit API is enabled."
            )
            return []

    _provider_labels = {
        "google.com": "google",
        "google": "google",
        "password": "email",
        "email": "email",
        "local-demo": "local-demo",
        "firebase": "firebase",
    }

    def _provider_label(value):
        raw = (value or "").strip()
        return _provider_labels.get(raw.casefold(), raw.casefold() or "unknown")

    def _admin_email_set():
        return {
            value.strip().casefold()
            for value in getattr(service.settings, "admin_emails", "").split(",")
            if value.strip()
        }

    def _effective_role(email, role):
        if (role or "").strip().casefold() == "admin":
            return "admin"
        if (email or "").strip().casefold() in _admin_email_set():
            return "admin"
        return "student"

    def _account_owner(uid, owner):
        account_id = uid.removeprefix("email_") if owner == "__email_password_auth__" else uid
        return repo.get(owner, "accounts", account_id)

    def _set_custom_account_disabled(uid, disabled):
        """Mirror the flag onto custom auth records so login can enforce it."""
        for owner in ("__google_auth__", "__email_password_auth__"):
            account = _account_owner(uid, owner)
            if account:
                repo.put(
                    owner,
                    "accounts",
                    {**account, "disabled": bool(disabled), "updated_at": now()},
                )

    def merged_admin_users(warnings=None):
        """Firebase Auth + custom Google/email accounts + Firestore profiles.

        Every source is merged, and a user with no profile document is still
        listed. Source failures are reported through ``warnings`` rather than
        returning silently incomplete data.
        """
        warnings = warnings if warnings is not None else []
        profiles = _profile_records(warnings)
        merged = {}

        for record in _firebase_auth_users(warnings):
            providers = [item.provider_id for item in (record.provider_data or [])]
            email = (record.email or "").strip().casefold()
            claims = record.custom_claims or {}
            merged[record.uid] = {
                "uid": record.uid,
                "email": email,
                "display_name": record.display_name or "",
                "provider": _provider_label(providers[0] if providers else "firebase"),
                "disabled": bool(record.disabled),
                "email_verified": bool(record.email_verified),
                "created_at": _iso_timestamp(record.user_metadata.creation_timestamp),
                "last_sign_in_at": _iso_timestamp(record.user_metadata.last_sign_in_timestamp),
                "role": _effective_role(email, "admin" if claims.get("admin") is True else "student"),
                "login_count": 0,
                "activity_count": 0,
                "sources": ["firebase-auth"],
            }

        # These collections are the account registry for Google and email
        # sign-in on BOTH storage backends. Reading them only for SQLite was
        # why production (Firestore) missed accounts without a profile doc.
        for owner, provider, source in (
            ("__google_auth__", "google", "google-auth"),
            ("__email_password_auth__", "email", "email-password"),
            ("__local_demo_auth__", "local-demo", "local-demo"),
        ):
            try:
                accounts = repo.list(owner, "accounts") or []
            except Exception as error:
                detail = f"{type(error).__name__}: {error}"
                logging.getLogger("cdmento").exception(
                    "Listing %s accounts failed: %s", owner, detail
                )
                warnings.append(f"Listing {source} accounts failed ({detail}).")
                continue
            for account in accounts:
                uid = account.get("uid") or account.get("id")
                if not uid:
                    continue
                email = (account.get("email") or "").strip().casefold()
                current = merged.get(uid, {})
                sources = sorted({*current.get("sources", []), source})
                merged[uid] = {
                    **current,
                    "uid": uid,
                    "email": email or current.get("email", ""),
                    "display_name": account.get("display_name")
                    or account.get("name")
                    or current.get("display_name", ""),
                    "provider": provider,
                    "disabled": bool(account.get("disabled", current.get("disabled", False))),
                    "email_verified": bool(account.get("email_verified", current.get("email_verified", False))),
                    "created_at": current.get("created_at") or _account_timestamp(account.get("created_at")),
                    "last_sign_in_at": _account_timestamp(account.get("last_sign_in_at"))
                    or current.get("last_sign_in_at"),
                    "role": _effective_role(email, current.get("role") or account.get("role", "student")),
                    "login_count": 0,
                    "activity_count": 0,
                    "sources": sources,
                }

        for uid, profile in profiles.items():
            email = (profile.get("email") or "").strip().casefold()
            current = merged.get(uid, {})
            roles = {
                (current.get("role") or "").strip().casefold(),
                (profile.get("role") or "").strip().casefold(),
            }
            sources = sorted({*current.get("sources", []), "profile"})
            merged[uid] = {
                **current,
                "uid": uid,
                "email": email or current.get("email", ""),
                "display_name": profile.get("display_name") or current.get("display_name", ""),
                "provider": _provider_label(profile.get("provider") or current.get("provider")),
                "role": _effective_role(email, "admin" if "admin" in roles else "student"),
                "disabled": bool(profile.get("disabled", current.get("disabled", False))),
                "email_verified": bool(profile.get("email_verified", current.get("email_verified", False))),
                "created_at": current.get("created_at") or profile.get("created_at"),
                "last_sign_in_at": profile.get("last_sign_in_at") or current.get("last_sign_in_at"),
                "login_count": 0,
                "activity_count": 0,
                "sources": sources,
            }

        logs = repo.list("__system_admin__", "access_logs") or []
        activities = repo.list("__system_admin__", "activity_logs") or []
        for item in merged.values():
            email = (item.get("email") or "").strip().casefold()
            successes = [
                log
                for log in logs
                if (log.get("email") or "").strip().casefold() == email
                and log.get("status") == "success"
            ]
            item["login_count"] = len(successes)
            item["activity_count"] = sum(
                1
                for log in activities
                if (log.get("user") or "").strip().casefold() == email
            )
            if not item.get("last_sign_in_at") and successes:
                item["last_sign_in_at"] = max(
                    (log.get("timestamp") or "" for log in successes), default=None
                )
            item.setdefault("sources", [])
            item.setdefault("email_verified", False)
        return sorted(
            merged.values(), key=lambda item: item.get("created_at") or "", reverse=True
        )

    @app.get("/api/v1/admin/users")
    def admin_users_list(
        admin: AdminOwner,
        skip: int = 0,
        limit: int | None = None,
        search: str | None = None,
        role: str | None = None,
        provider: str | None = None,
        status: str | None = None,
    ):
        warnings: list[str] = []
        items = merged_admin_users(warnings)
        if search:
            needle = search.strip().casefold()
            items = [
                item
                for item in items
                if needle in (item.get("uid") or "").casefold()
                or needle in (item.get("email") or "").casefold()
                or needle in (item.get("display_name") or "").casefold()
            ]
        if role:
            items = [item for item in items if item["role"] == role]
        if provider:
            items = [item for item in items if item["provider"] == provider]
        if status in ("active", "disabled"):
            want_disabled = status == "disabled"
            items = [item for item in items if bool(item.get("disabled")) is want_disabled]
        total = len(items)
        skip = max(skip, 0)
        if limit is not None:
            limit = max(1, min(limit, 1000))
        window = items[skip:] if limit is None else items[skip : skip + limit]
        source_counts: dict[str, int] = {}
        for item in items:
            for source in item.get("sources", []):
                source_counts[source] = source_counts.get(source, 0) + 1
        return {
            "items": window,
            "total": total,
            "warnings": warnings,
            "degraded": bool(warnings),
            "sources": source_counts,
        }

    def _admin_user_record(uid):
        return next((item for item in merged_admin_users() if item["uid"] == uid), None)

    def _ensure_user_profile(uid, **fields):
        """Create a profile even for accounts that never had one written."""
        profile = repo.get(uid, "profile", "account")
        if not profile:
            record = _admin_user_record(uid) or {}
            email = record.get("email", "")
            profile = {
                "id": "account",
                "email": email,
                "display_name": record.get("display_name")
                or (email.split("@", 1)[0] if email else ""),
                "provider": record.get("provider", "unknown"),
                "created_at": record.get("created_at") or now(),
            }
        if not profile:
            raise HTTPException(404, "User not found.")
        return repo.put(
            uid,
            "profile",
            {**profile, "id": "account", **fields, "updated_at": now()},
        )

    @app.patch("/api/v1/admin/users/{uid}/role")
    def admin_user_role(uid: str, data: dict, admin: AdminOwner):
        role = (data.get("role") or "").strip().casefold()
        if role not in ("admin", "student"):
            raise HTTPException(400, "Role must be admin or student.")
        _ensure_user_profile(uid, role=role)
        warnings: list[str] = []
        if service.settings.data_backend == "firestore" or service.settings.auth_mode == "firebase":
            try:
                from firebase_admin import auth

                firebase_user = auth.get_user(uid)
                claims = dict(firebase_user.custom_claims or {})
                claims["admin"] = role == "admin"
                auth.update_user(uid, custom_claims=claims)
            except Exception as error:
                # Custom Google/email accounts are not Firebase Auth users; that
                # is expected. Only genuine claim-sync failures are surfaced.
                if type(error).__name__ not in ("UserNotFoundError", "ValueError"):
                    detail = f"{type(error).__name__}: {error}"
                    logging.getLogger("cdmento").exception(
                        "Role claim sync failed for %s: %s", uid, detail
                    )
                    warnings.append(f"Role saved, but Firebase claims were not updated ({detail}).")
        return {"uid": uid, "role": role, "warnings": warnings}

    @app.patch("/api/v1/admin/users/{uid}/status")
    def admin_user_status(uid: str, data: dict, admin: AdminOwner):
        disabled = bool(data.get("disabled"))
        _ensure_user_profile(uid, disabled=disabled)
        _set_custom_account_disabled(uid, disabled)
        warnings: list[str] = []
        if service.settings.data_backend == "firestore" or service.settings.auth_mode == "firebase":
            try:
                from firebase_admin import auth

                auth.update_user(uid, disabled=disabled)
            except Exception as error:
                if type(error).__name__ not in ("UserNotFoundError", "ValueError"):
                    detail = f"{type(error).__name__}: {error}"
                    logging.getLogger("cdmento").exception(
                        "Firebase Admin status update failed for %s: %s", uid, detail
                    )
                    warnings.append(f"Account status saved, but Firebase was not updated ({detail}).")
        return {"uid": uid, "disabled": disabled, "warnings": warnings}

    @app.get("/api/v1/admin/users/{uid}/details")
    def admin_user_details(uid: str, admin: AdminOwner):
        user = _admin_user_record(uid)
        if not user:
            raise HTTPException(404, "User not found.")
        email = (user.get("email") or "").casefold()
        logins = [item for item in repo.list("__system_admin__", "access_logs") if item.get("email", "").casefold() == email]
        activity = [item for item in repo.list("__system_admin__", "activity_logs") if item.get("user", "").casefold() == email]
        tickets = [item for item in repo.list("__system_admin__", "feedback") if item.get("user", "").casefold() == email]
        return {**user, "logins": logins, "activity": activity, "tickets": tickets}

    @app.post("/api/v1/auth/demo/login")
    def demo_login(data: S.DemoLogin, request: Request):
        auth = local_demo(request)
        client = request.client.host if request.client else "127.0.0.1"
        try:
            res = auth.login(data.email, data.password, client)
            upsert_user_profile(
                res["profile"]["uid"],
                res["profile"]["email"],
                res["profile"].get("displayName"),
                "local-demo",
                email_verified=True,
            )
            record_access_log(data.email, "local-demo", "success", client, "admin")
            return res
        except Exception:
            record_access_log(data.email, "local-demo", "failed", client)
            raise

    def google_auth(request):
        if service.settings.auth_mode != "google":
            raise HTTPException(404, "Google sign-in is not enabled.")
        return app.state.google_auth

    @app.post("/api/v1/auth/google/prepare")
    def google_prepare(data: S.GoogleLogin, request: Request):
        auth = google_auth(request)
        client = request.client.host if request.client else "unknown"
        return auth.prepare(data.credential, data.remember, client)

    @app.post("/api/v1/auth/google/register")
    def google_register(data: S.GoogleLogin, request: Request):
        auth = google_auth(request)
        client = request.client.host if request.client else "unknown"
        result = auth.register(data.credential, data.remember, client)
        profile = result.get("profile", {})
        upsert_user_profile(
            profile.get("uid"),
            profile.get("email"),
            profile.get("displayName"),
            "google",
            email_verified=True,
        )
        record_access_log(profile.get("email", "google-user"), "google", "success", client)
        return result

    @app.post("/api/v1/auth/google/login")
    def google_login(data: S.GoogleLogin, request: Request):
        auth = google_auth(request)
        client = request.client.host if request.client else "unknown"
        try:
            res = auth.login(data.credential, data.remember, client)
            email = res.get("profile", {}).get("email") or "google-user"
            profile = res.get("profile", {})
            upsert_user_profile(
                profile.get("uid"),
                email,
                profile.get("displayName"),
                "google",
                email_verified=True,
            )
            record_access_log(email, "google", "success", client)
            return res
        except Exception:
            record_access_log("google-user", "google", "failed", client)
            raise

    @app.get("/api/v1/auth/google/session")
    def google_session(request: Request, owner: Owner):
        return google_auth(request).profile(owner)

    @app.post("/api/v1/auth/google/logout", status_code=204)
    def google_logout(request: Request):
        auth = google_auth(request)
        token = request.headers.get("authorization", "")
        if token.startswith("Bearer "):
            auth.logout(token[7:])
        return Response(status_code=204)

    def email_auth(request):
        if service.settings.auth_mode != "google":
            raise HTTPException(404, "Email/password sign-in is not enabled.")
        return app.state.password_auth

    @app.post("/api/v1/auth/email/signup", status_code=202)
    def email_signup(data: S.PasswordSignup, request: Request):
        if not app.state.brevo_mailer.configured:
            raise HTTPException(503, "Brevo email is not configured yet.")
        client = request.client.host if request.client else "unknown"
        try:
            auth = email_auth(request)
            result = auth.signup(
                data.email, data.password, data.display_name, client
            )
            # Create the profile immediately so a brand-new (not yet verified)
            # signup is visible in Admin > Users before its first login.
            account = auth.account(data.email)
            if account:
                upsert_user_profile(
                    account.get("uid") or "email_" + account["id"],
                    account.get("email"),
                    account.get("display_name"),
                    "email",
                    email_verified=bool(account.get("email_verified")),
                    mark_sign_in=False,
                    preserve_display_name=True,
                )
            return result
        except RuntimeError:
            raise HTTPException(503, "The verification email could not be sent. Please try again.") from None

    @app.post("/api/v1/auth/email/login")
    def email_login(data: S.PasswordLogin, request: Request):
        client = request.client.host if request.client else "unknown"
        try:
            res = email_auth(request).login(
                data.email, data.password, client, data.remember
            )
            profile = res.get("profile", {})
            upsert_user_profile(
                profile.get("uid"),
                profile.get("email") or data.email,
                profile.get("displayName"),
                "email",
                email_verified=bool(profile.get("emailVerified", True)),
            )
            record_access_log(data.email, "email", "success", client)
            return res
        except Exception:
            record_access_log(data.email, "email", "failed", client)
            raise

    @app.post("/api/v1/auth/email/session")
    def email_session(request: Request, owner: Owner):
        auth = email_auth(request)
        token = request.headers.get("authorization", "")
        claims = auth.resolve(token[7:])
        return auth.profile(claims["uid"])

    @app.post("/api/v1/auth/email/verify")
    def verify_email(data: S.PasswordAction, request: Request):
        email_auth(request).verify_email(data.token)
        return {"message": "Your email is verified. You can now log in."}

    @app.post("/api/v1/auth/email/password-reset/request")
    def request_password_reset(data: S.PasswordResetRequest, request: Request):
        if not app.state.brevo_mailer.configured:
            raise HTTPException(503, "Brevo email is not configured yet.")
        client = request.client.host if request.client else "unknown"
        try:
            return email_auth(request).request_reset(data.email, client)
        except RuntimeError:
            raise HTTPException(503, "The reset email could not be sent. Please try again.") from None

    @app.post("/api/v1/auth/email/password-reset/confirm")
    def confirm_password_reset(data: S.PasswordReset, request: Request):
        email_auth(request).reset_password(data.token, data.password)
        return {"message": "Your password has been updated."}

    @app.post("/api/v1/auth/email/logout", status_code=204)
    def email_logout(request: Request):
        auth = email_auth(request)
        token = request.headers.get("authorization", "")
        if token.startswith("Bearer account_"):
            auth.logout(token[7:])
        return Response(status_code=204)

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
        if service.settings.auth_mode not in ("firebase", "google"):
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
        claims = getattr(request.state, "account_claims", {}) or {}
        existing = repo.get(owner, "profile", "account") or {}
        demo = app.state.demo_auth.profile() if owner == "demo-student" else {}
        email = claims.get("email") or demo.get("email") or existing.get("email", "")
        if email:
            provider = claims.get("firebase", {}).get("sign_in_provider", "firebase")
            if owner.startswith("google_"):
                provider = "google"
            elif owner.startswith("email_"):
                provider = "email"
            upsert_user_profile(
                owner,
                email,
                claims.get("name") or demo.get("displayName") or existing.get("display_name"),
                provider,
                claims,
                preserve_display_name=True,
                email_verified=claims.get("email_verified"),
            )
            existing = repo.get(owner, "profile", "account") or existing
        admin_emails = [
            e.strip().casefold()
            for e in getattr(service.settings, "admin_emails", "").split(",")
            if e.strip()
        ]
        is_adm = (
            claims.get("admin") is True
            or claims.get("role") == "admin"
            or (email.strip().casefold() in admin_emails)
            or (owner == "demo-student")
            or (existing.get("role") == "admin")
        )
        return {
            "display_name": claims.get("name") or demo.get("displayName") or "Student",
            "bio": "",
            "study_goal": "",
            "avatar": "initials",
            "color": "purple",
            **existing,
            "email": email,
            "role": "admin" if is_adm else "student",
            "is_admin": is_adm,
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
                # Validate the full artifact shape (not just id/notebook/kind) so
                # imported backups cannot inject unexpected fields or crash
                # downstream readers. Unknown kinds raise ValueError.
                S.validate_artifact(a)
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
        result = repo.put(
            owner,
            "notebooks",
            {**data.model_dump(), "id": nid, "created_at": now()},
            expected=0,
        )
        record_activity(owner, "created_notebook", result["name"], result.get("color", ""))
        return result

    @app.patch("/api/v1/notebooks/{nid}")
    def rename_notebook(nid: str, data: S.NotebookInput, owner: Owner, request: Request):
        current = notebook(owner, nid)
        result = repo.put(
            owner, "notebooks", {**current, "name": data.name, "color": data.color}
        )
        record_activity(owner, "renamed_notebook", data.name, f"Notebook: {nid}", request)
        return result

    @app.delete("/api/v1/notebooks/{nid}", status_code=202)
    def remove_notebook(nid: str, owner: Owner, request: Request):
        current = notebook(owner, nid)
        repo.put(owner, "notebooks", {**current, "deleting": True})
        record_activity(owner, "deleted_notebook", current.get("name", nid), f"Notebook: {nid}", request)
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
        await run_in_threadpool(
            service.storage.put,
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
        record_activity(owner, "uploaded_source", name, f"{len(content)} bytes")
        return {"source": public_source(source), "job_id": job["id"]}

    @app.post("/api/v1/notebooks/{nid}/sources/upload-sessions", status_code=201)
    def create_source_upload(nid: str, data: S.SourceUploadSession, owner: Owner):
        notebook(owner, nid)
        name = Path(data.name.replace("\\", "/")).name[:200]
        extension = name.rsplit(".", 1)[-1].lower()
        if extension not in ("pdf", "docx", "txt"):
            raise HTTPException(415, "Choose a PDF, DOCX or TXT document.")
        if data.size < 1 or data.size > service.settings.max_upload_bytes:
            raise HTTPException(413, "Files must be 10 MB or smaller.")
        session_id = identifier()
        return repo.put(
            owner,
            "upload_sessions",
            {
                "id": session_id,
                "notebook": nid,
                "name": name,
                "type": extension,
                "size": data.size,
                "parts": [],
                "created_at": now(),
            },
            expected=0,
        )

    @app.put(
        "/api/v1/notebooks/{nid}/sources/upload-sessions/{upload_id}/parts/{part_index}"
    )
    async def put_source_upload_part(
        nid: str,
        upload_id: str,
        part_index: int,
        owner: Owner,
        file: UploadFile = File(...),
    ):
        session = owned(owner, "upload_sessions", upload_id)
        if session["notebook"] != nid:
            raise HTTPException(404, "This upload does not exist.")
        chunk_size = 3_500_000
        count = (session["size"] + chunk_size - 1) // chunk_size
        if part_index < 0 or part_index >= count:
            raise HTTPException(400, "This upload part is invalid.")
        content = await file.read(chunk_size + 1)
        expected_size = min(chunk_size, session["size"] - part_index * chunk_size)
        if len(content) != expected_size:
            raise HTTPException(400, "This upload part has an invalid size.")
        key = f"tmp/{owner}/source-uploads/{upload_id}/{part_index}"
        # Blob/Storage clients are blocking; keep them off the event loop.
        await run_in_threadpool(
            service.storage.put, key, content, "application/octet-stream"
        )
        parts = sorted(set(session.get("parts", []) + [part_index]))
        return repo.put(owner, "upload_sessions", {**session, "parts": parts})

    @app.post(
        "/api/v1/notebooks/{nid}/sources/upload-sessions/{upload_id}/complete",
        status_code=202,
    )
    def complete_source_upload(nid: str, upload_id: str, owner: Owner):
        session = owned(owner, "upload_sessions", upload_id)
        if session["notebook"] != nid:
            raise HTTPException(404, "This upload does not exist.")
        chunk_size = 3_500_000
        count = (session["size"] + chunk_size - 1) // chunk_size
        if session.get("parts") != list(range(count)):
            raise HTTPException(409, "Some file parts are missing. Retry the upload.")
        content = bytearray()
        keys = [
            f"tmp/{owner}/source-uploads/{upload_id}/{part}"
            for part in range(count)
        ]
        try:
            for key in keys:
                content.extend(service.storage.get(key))
        except FileNotFoundError:
            raise HTTPException(409, "Some file parts expired. Upload the file again.") from None
        if len(content) != session["size"]:
            raise HTTPException(400, "The uploaded file size did not match.")
        checksum = hashlib.sha256(content).hexdigest()
        existing = next(
            (
                source
                for source in repo.list(owner, "sources")
                if source["notebook"] == nid and source.get("checksum") == checksum
            ),
            None,
        )
        for key in keys:
            service.storage.delete(key)
        repo.delete(owner, "upload_sessions", upload_id)
        if existing:
            return {"source": public_source(existing), "duplicate": True}
        sid = identifier()
        extension = session["type"]
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
                "name": session["name"],
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

    @app.delete("/api/v1/notebooks/{nid}/sources/upload-sessions/{upload_id}", status_code=204)
    def cancel_source_upload(nid: str, upload_id: str, owner: Owner):
        session = repo.get(owner, "upload_sessions", upload_id)
        if not session or session.get("notebook") != nid:
            return Response(status_code=204)
        for part in session.get("parts", []):
            service.storage.delete(
                f"tmp/{owner}/source-uploads/{upload_id}/{part}"
            )
        repo.delete(owner, "upload_sessions", upload_id)
        return Response(status_code=204)

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
    def rename_source(sid: str, data: S.Rename, owner: Owner, request: Request):
        source = owned(owner, "sources", sid)
        result = public_source(repo.put(owner, "sources", {**source, "name": data.name}))
        record_activity(owner, "renamed_source", data.name, f"Source: {sid}", request)
        return result

    @app.delete("/api/v1/sources/{sid}", status_code=204)
    def remove_source(sid: str, owner: Owner, request: Request):
        source = owned(owner, "sources", sid)
        name = source.get("name", sid)
        service.delete_source(owner, source)
        record_activity(owner, "deleted_source", name, f"Source: {sid}", request)
        return Response(status_code=204)

    @app.post("/api/v1/sources/{sid}/reprocess", status_code=202)
    def reprocess_source(sid: str, owner: Owner, request: Request):
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
        record_activity(owner, "reprocessed_source", source.get("name", sid), f"Source: {sid}", request)
        return {"job_id": job["id"]}

    @app.post("/api/v1/sources/{sid}/retry", status_code=202)
    def retry_source(sid: str, owner: Owner, request: Request):
        source = owned(owner, "sources", sid)
        if source["status"] not in ("failed", "needs_ocr") or not source.get(
            "storage_key"
        ):
            raise HTTPException(
                409, "This source cannot be retried in its current state."
            )
        repo.put(owner, "sources", {**source, "status": "queued", "error": None})
        job = service.enqueue(
            owner, "ingest", notebook=source["notebook"], source_id=sid
        )
        record_activity(owner, "retried_source", source.get("name", sid), f"Source: {sid}", request)
        return {"job_id": job["id"]}

    @app.get("/api/v1/jobs/{jid}")
    def job(jid: str, owner: Owner):
        current = owned(owner, "jobs", jid)
        # Serverless instances have no persistent worker; polling resumes due work.
        # run_job is idempotent: it holds a per-job lease and uses a CAS update,
        # so repeated GETs from caches or retries never start duplicate work.
        if os.getenv("VERCEL") == "1" and current["status"] in ("queued", "waiting", "processing"):
            service.run_job(owner, jid)
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
        elif os.getenv("VERCEL") == "1":
            service.run_job(owner, jid)
            job = owned(owner, "jobs", jid)
        return job

    @app.post("/api/v1/notebooks/{nid}/notes", status_code=201)
    def create_note(nid: str, data: S.NoteInput, owner: Owner):
        notebook(owner, nid)
        result = repo.put(
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
        record_activity(owner, "created_note", result.get("title", "Untitled"), f"Notebook: {nid}")
        return result

    @app.patch("/api/v1/notes/{note_id}")
    def update_note(note_id: str, data: S.NoteInput, owner: Owner, request: Request):
        current = owned(owner, "notes", note_id)
        notebook(owner, current["notebook"])
        if data.revision is None:
            raise HTTPException(422, "Include the note revision when saving.")
        result = repo.put(
            owner,
            "notes",
            {
                **current,
                **data.model_dump(exclude={"id", "revision"}),
                "updated_at": now(),
            },
            expected=data.revision,
        )
        record_activity(owner, "updated_note", result.get("title", "Untitled"), f"Note: {note_id}", request)
        return result

    @app.delete("/api/v1/notes/{note_id}", status_code=204)
    def delete_note(note_id: str, owner: Owner, request: Request):
        current = owned(owner, "notes", note_id)
        title = current.get("title", "Untitled")
        repo.delete(owner, "notes", note_id)
        record_activity(owner, "deleted_note", title, f"Note: {note_id}", request)
        return Response(status_code=204)

    def conversation_record(nid, conversation_id, owner):
        notebook(owner, nid)
        value = repo.get(owner, "conversations", conversation_id)
        if value is None and conversation_id == nid:
            return {
                "id": nid,
                "notebook": nid,
                "title": "New chat",
                "messages": [],
                "summary": "",
            }
        if not value or value.get("notebook") != nid:
            raise HTTPException(404, "Conversation not found.")
        return value

    @app.get("/api/v1/notebooks/{nid}/conversation")
    def conversation(nid: str, owner: Owner):
        return conversation_record(nid, nid, owner)

    @app.get("/api/v1/notebooks/{nid}/conversations")
    def list_conversations(nid: str, owner: Owner):
        notebook(owner, nid)
        result = []
        for value in repo.list(owner, "conversations"):
            if value.get("notebook") != nid:
                continue
            messages = value.get("messages") or []
            first_user = next(
                (message.get("text", "") for message in messages if message.get("role") == "user"),
                "",
            )
            created_at = value.get("created_at") or next(
                (message.get("created_at") for message in messages if message.get("created_at")),
                "",
            )
            updated_at = value.get("updated_at") or next(
                (message.get("created_at") for message in reversed(messages) if message.get("created_at")),
                created_at,
            )
            title = value.get("title") or (first_user.strip().splitlines() or [""])[0][:80] or "New chat"
            result.append({
                "id": value["id"],
                "notebook": nid,
                "title": title,
                "created_at": created_at,
                "updated_at": updated_at,
                "message_count": len(messages),
            })
        return sorted(result, key=lambda item: item["updated_at"], reverse=True)

    @app.post("/api/v1/notebooks/{nid}/conversations", status_code=201)
    def create_conversation(nid: str, owner: Owner):
        notebook(owner, nid)
        timestamp = now()
        value = {
            "id": identifier(),
            "notebook": nid,
            "title": "New chat",
            "messages": [],
            "summary": "",
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        saved = repo.put(owner, "conversations", value)
        return {**saved, "message_count": 0}

    @app.get("/api/v1/notebooks/{nid}/conversations/{conversation_id}")
    def get_conversation(nid: str, conversation_id: str, owner: Owner):
        return conversation_record(nid, conversation_id, owner)

    @app.delete("/api/v1/notebooks/{nid}/conversations/{conversation_id}", status_code=204)
    def delete_conversation(nid: str, conversation_id: str, owner: Owner):
        conversation_record(nid, conversation_id, owner)
        repo.delete(owner, "conversations", conversation_id)
        return Response(status_code=204)

    @app.post("/api/v1/notebooks/{nid}/messages")
    def chat(nid: str, data: S.ChatInput, owner: Owner):
        sources = selected(owner, nid, data.source_ids)
        ai_ready(owner)
        conversation_id = data.conversation_id or nid
        history = conversation_record(nid, conversation_id, owner)
        with locks[(owner, nid, "chat")]:
            pending = next(
                (
                    j
                    for j in repo.list(owner, "jobs")
                    if j["kind"] == "chat"
                    and j.get("notebook") == nid
                    and (j.get("conversation_id") or j.get("notebook")) == conversation_id
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
                    conversation_id=conversation_id,
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
            return service.save_answer(
                owner,
                nid,
                data.question,
                result,
                history,
                conversation_id=conversation_id,
            )

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
    def save_reviewer_note(
        aid: str,
        request: Request,
        owner: Owner,
        options: S.ReviewerNoteOptions | None = None,
    ):
        artifact = owned(owner, "artifacts", aid)
        if artifact["kind"] != "guide":
            raise HTTPException(400, "Choose a saved reviewer.")
        options = options or S.ReviewerNoteOptions()
        def text_node(text, bold=False, italic=False):
            node = {"type": "text", "text": str(text)}
            marks = []
            if bold:
                marks.append({"type": "bold"})
            if italic:
                marks.append({"type": "italic"})
            if marks:
                node["marks"] = marks
            return node

        def paragraph(*nodes):
            content = [node for node in nodes if node]
            return {
                "type": "paragraph",
                "content": content or [text_node("")],
            }

        def heading(text, level=2):
            return {
                "type": "heading",
                "attrs": {"level": level},
                "content": [text_node(text)],
            }

        def bullet_list(items):
            return {
                "type": "bullet_list",
                "content": [
                    {
                        "type": "list_item",
                        "content": [paragraph(text_node(item))],
                    }
                    for item in items
                    if item
                ],
            }

        def text_blocks(text):
            """Preserve paragraph breaks and simple bullet/numbered lists."""
            blocks = []
            for chunk in (text or "").strip().split("\n\n"):
                lines = [line.strip() for line in chunk.splitlines() if line.strip()]
                if not lines:
                    continue
                markers = ("- ", "* ", "• ", "· ")

                def numbered_parts(line):
                    head, sep, rest = line.partition(" ")
                    if sep and head.rstrip(".)").isdigit():
                        return rest.strip()
                    return None

                numbered = [numbered_parts(line) for line in lines]
                if all(line.startswith(markers) for line in lines):
                    blocks.append(
                        bullet_list([line[2:].strip() for line in lines])
                    )
                elif all(part is not None for part in numbered):
                    blocks.append(bullet_list(numbered))
                else:
                    blocks.append(paragraph(text_node(" ".join(lines))))
            return blocks

        document_content = []
        plain_lines = []

        if options.include_summary:
            overview = (artifact.get("overview") or "").strip()
            if overview:
                document_content.append(heading("Summary"))
                document_content.extend(text_blocks(overview))
                plain_lines.extend(["Summary", overview])

        if options.include_sections:
            for section in artifact.get("sections", []):
                title = section.get("heading") or "Study section"
                document_content.append(heading(title))
                document_content.extend(text_blocks(section.get("content", "")))
                plain_lines.extend([title, section.get("content", "")])

        if options.include_practice:
            questions = artifact.get("practice_questions", [])
            if questions:
                document_content.append(heading("Practice questions"))
                plain_lines.append("Practice questions")
                for index, question in enumerate(questions, start=1):
                    document_content.append(
                        paragraph(
                            text_node(f"Q{index}. {question.get('question', '')}", bold=True)
                        )
                    )
                    document_content.append(
                        paragraph(
                            text_node("Answer: ", bold=True),
                            text_node(question.get("answer", "")),
                        )
                    )
                    plain_lines.extend(
                        [
                            f"Q{index}. {question.get('question', '')}",
                            f"Answer: {question.get('answer', '')}",
                        ]
                    )

        if options.include_disclaimer:
            disclaimer = (
                "AI-generated study material can make mistakes. "
                "Compare every explanation and citation with the original sources."
            )
            document_content.append(heading("Disclaimer"))
            document_content.append(
                paragraph(text_node(disclaimer, italic=True))
            )
            plain_lines.extend(["Disclaimer", disclaimer])

        if not document_content:
            raise HTTPException(
                400, "Choose at least one part of the reviewer to save."
            )

        document = {"type": "doc", "content": document_content}
        if len(json.dumps(document)) > 200000:
            raise HTTPException(
                400,
                "This reviewer is too large for one note. Keep it in Sources or copy individual sections.",
            )

        title = artifact.get("title") or "Study reviewer"
        payload = {
            "title": title,
            "content": "\n\n".join(line for line in plain_lines if line).strip(),
            "document": document,
            "reviewer_id": aid,
            "reviewer_options": options.model_dump(),
            "updated_at": now(),
        }
        existing = next(
            (n for n in repo.list(owner, "notes") if n.get("reviewer_id") == aid),
            None,
        )
        if existing:
            result = repo.put(
                owner,
                "notes",
                {
                    **existing,
                    **payload,
                },
                expected=existing.get("revision", 0),
            )
            record_activity(owner, "updated_note", title, f"Reviewer: {aid}", request)
        else:
            result = repo.put(
                owner,
                "notes",
                {
                    "id": identifier(),
                    "notebook": artifact["notebook"],
                    **payload,
                },
                expected=0,
            )
            record_activity(owner, "created_note", title, f"Reviewer: {aid}", request)
        return result

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
            result = repo.put(
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
            record_activity(owner, "started_focus", "Focus Timer", f"{data.duration} seconds")
            return result

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
        result = repo.put(
            owner,
            "tasks",
            {"id": identifier(), **data.model_dump(), "created_at": now()},
        )
        record_activity(owner, "created_task", result.get("text", "Task"), "")
        return result

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
        result = repo.put(
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
        record_activity(owner, "created_quiz", data.title, f"{len(questions)} questions")
        return result

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

    # --------------------------------------------------------------------------
    # Admin API & Monitoring Endpoints (Protected by AdminOwner)
    # --------------------------------------------------------------------------

    def seed_admin_data_if_empty():
        try:
            existing = repo.list("__system_admin__", "access_logs")
            if not existing:
                now_str = datetime.now(timezone.utc).isoformat()
                now_t = time.time()
                sample_access = [
                    {
                        "id": identifier(),
                        "email": "lozadamarklaurence226@gmail.com",
                        "role": "admin",
                        "auth_method": "google",
                        "status": "success",
                        "ip": "127.0.0.1",
                        "timestamp": now_str,
                    },
                    {
                        "id": identifier(),
                        "email": "demo@cdmento.local",
                        "role": "admin",
                        "auth_method": "local-demo",
                        "status": "success",
                        "ip": "127.0.0.1",
                        "timestamp": datetime.fromtimestamp(now_t - 3600, tz=timezone.utc).isoformat(),
                    },
                    {
                        "id": identifier(),
                        "email": "student1@cdm.edu.ph",
                        "role": "student",
                        "auth_method": "google",
                        "status": "success",
                        "ip": "112.198.71.4",
                        "timestamp": datetime.fromtimestamp(now_t - 7200, tz=timezone.utc).isoformat(),
                    },
                    {
                        "id": identifier(),
                        "email": "unknown@malicious.com",
                        "role": "student",
                        "auth_method": "email",
                        "status": "failed",
                        "ip": "185.220.101.5",
                        "timestamp": datetime.fromtimestamp(now_t - 14400, tz=timezone.utc).isoformat(),
                    },
                ]
                for item in sample_access:
                    repo.put("__system_admin__", "access_logs", item)

                sample_feedback = [
                    {
                        "id": identifier(),
                        "user": "student1@cdm.edu.ph",
                        "category": "suggestion",
                        "subject": "Add dark mode toggle to flashcard viewer",
                        "message": "When studying late at night, the flashcards are bright white. Would love a night mode!",
                        "status": "open",
                        "admin_notes": "Added to backlog for next sprint.",
                        "created_at": datetime.fromtimestamp(now_t - 18000, tz=timezone.utc).isoformat(),
                    },
                    {
                        "id": identifier(),
                        "user": "student2@cdm.edu.ph",
                        "category": "bug",
                        "subject": "PDF file upload on slow mobile connection",
                        "message": "The progress bar paused on 90% before finishing.",
                        "status": "resolved",
                        "admin_notes": "Chunked upload resilience verified.",
                        "created_at": datetime.fromtimestamp(now_t - 86400, tz=timezone.utc).isoformat(),
                    },
                ]
                for item in sample_feedback:
                    repo.put("__system_admin__", "feedback", item)

                sample_activity = [
                    {
                        "id": identifier(),
                        "user": "lozadamarklaurence226@gmail.com",
                        "action": "login",
                        "target": "Admin Console",
                        "metadata": "IP: 127.0.0.1",
                        "timestamp": now_str,
                    },
                    {
                        "id": identifier(),
                        "user": "student1@cdm.edu.ph",
                        "action": "generated_quiz",
                        "target": "Database Normalization Quiz",
                        "metadata": "10 questions generated via AI",
                        "timestamp": datetime.fromtimestamp(now_t - 7000, tz=timezone.utc).isoformat(),
                    },
                    {
                        "id": identifier(),
                        "user": "student1@cdm.edu.ph",
                        "action": "uploaded_source",
                        "target": "IT204_Lecture_Notes.pdf",
                        "metadata": "1.4 MB, 18 pages indexed",
                        "timestamp": datetime.fromtimestamp(now_t - 7100, tz=timezone.utc).isoformat(),
                    },
                ]
                for item in sample_activity:
                    repo.put("__system_admin__", "activity_logs", item)
        except Exception:
            pass

    def remove_legacy_seed_activity():
        """Remove rows from the old demo-only admin feed without touching real events."""
        seeded = {
            ("lozadamarklaurence226@gmail.com", "login", "Admin Console"),
            ("student1@cdm.edu.ph", "generated_quiz", "Database Normalization Quiz"),
            ("student1@cdm.edu.ph", "uploaded_source", "IT204_Lecture_Notes.pdf"),
        }
        for item in repo.list("__system_admin__", "activity_logs"):
            if (item.get("user"), item.get("action"), item.get("target")) in seeded:
                repo.delete("__system_admin__", "activity_logs", item["id"])

        seeded_access = {
            ("lozadamarklaurence226@gmail.com", "127.0.0.1"),
            ("demo@cdmento.local", "127.0.0.1"),
            ("student1@cdm.edu.ph", "112.198.71.4"),
            ("unknown@malicious.com", "185.220.101.5"),
        }
        for item in repo.list("__system_admin__", "access_logs"):
            if (item.get("email"), item.get("ip")) in seeded_access:
                repo.delete("__system_admin__", "access_logs", item["id"])

    remove_legacy_seed_activity()

    # Activity and access feeds must contain real events only. Do not seed demo rows.

    @app.get("/api/v1/admin/dashboard/kpis")
    def admin_dashboard_kpis(admin: AdminOwner):
        try:
            total_users = len(merged_admin_users())
        except HTTPException:
            raise

        access_logs = repo.list("__system_admin__", "access_logs") or []
        now_ts = time.time()
        day_ago = now_ts - 86400

        def parse_ts(item):
            try:
                return datetime.fromisoformat(item["timestamp"]).timestamp()
            except Exception:
                return 0

        daily_logins = sum(1 for log in access_logs if parse_ts(log) >= day_ago and log.get("status") == "success")
        active_today_set = {
            log.get("email") for log in access_logs if parse_ts(log) >= day_ago and log.get("status") == "success"
        }
        active_users_today = len(active_today_set) if active_today_set else 1

        feedback_tickets = repo.list("__system_admin__", "feedback") or []
        open_tickets = sum(1 for t in feedback_tickets if t.get("status") == "open")

        error_logs = repo.list("__system_admin__", "error_logs") or []
        unresolved_errors = sum(1 for e in error_logs if e.get("status", "open") == "open")

        return {
            "total_users": total_users,
            "daily_logins": max(daily_logins, 1),
            "active_users_today": max(active_users_today, 1),
            "open_tickets": open_tickets,
            "unresolved_errors": unresolved_errors,
        }

    @app.get("/api/v1/admin/access_logs")
    def admin_access_logs(
        admin: AdminOwner,
        search: str | None = None,
        status: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ):
        items = repo.list("__system_admin__", "access_logs") or []
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        if status and status != "all":
            items = [x for x in items if x.get("status") == status]
        if search:
            s_lower = search.lower()
            items = [
                x
                for x in items
                if s_lower in x.get("email", "").lower()
                or s_lower in x.get("ip", "").lower()
                or s_lower in x.get("auth_method", "").lower()
                or s_lower in x.get("role", "").lower()
            ]
        total = len(items)
        return {"items": items[skip : skip + limit], "total": total}

    @app.get("/api/v1/admin/activity_logs")
    def admin_activity_logs(
        admin: AdminOwner,
        search: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ):
        items = repo.list("__system_admin__", "activity_logs") or []
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        if search:
            s_lower = search.lower()
            items = [
                x
                for x in items
                if s_lower in x.get("user", "").lower()
                or s_lower in x.get("action", "").lower()
                or s_lower in x.get("target", "").lower()
            ]
        total = len(items)
        return {"items": items[skip : skip + limit], "total": total}

    @app.get("/api/v1/admin/feedback_support")
    def admin_feedback_support(
        admin: AdminOwner,
        status: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ):
        items = repo.list("__system_admin__", "feedback") or []
        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        if status and status != "all":
            items = [x for x in items if x.get("status") == status]
        total = len(items)
        return {"items": items[skip : skip + limit], "total": total}

    @app.patch("/api/v1/admin/feedback_support/{ticket_id}")
    def admin_update_feedback(
        ticket_id: str,
        data: S.AdminFeedbackUpdate,
        admin: AdminOwner,
    ):
        ticket = repo.get("__system_admin__", "feedback", ticket_id)
        if not ticket:
            raise HTTPException(404, "Feedback ticket not found.")
        ticket["status"] = data.status
        if data.admin_notes is not None:
            ticket["admin_notes"] = data.admin_notes
        ticket["updated_at"] = datetime.now(timezone.utc).isoformat()
        repo.put("__system_admin__", "feedback", ticket)
        return ticket

    @app.post("/api/v1/feedback", status_code=201)
    def submit_user_feedback(
        data: S.FeedbackInput,
        request: Request,
        owner: Owner,
    ):
        claims = getattr(request.state, "account_claims", {}) or {}
        email = claims.get("email") or (owner if not owner.startswith("enc_") else "student")
        ticket = {
            "id": identifier(),
            "user": email,
            "category": data.category,
            "subject": data.subject,
            "message": data.message,
            "status": "open",
            "admin_notes": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        repo.put("__system_admin__", "feedback", ticket)
        return {"message": "Thank you! Your feedback has been received.", "id": ticket["id"]}

    @app.get("/api/v1/admin/error_logs")
    def admin_error_logs(
        admin: AdminOwner,
        severity: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ):
        items = repo.list("__system_admin__", "error_logs") or []
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        if severity and severity != "all":
            items = [x for x in items if x.get("severity") == severity]
        total = len(items)
        return {"items": items[skip : skip + limit], "total": total}

    @app.get("/api/v1/admin/system_stats")
    def admin_system_stats(admin: AdminOwner):
        import platform
        return {
            "auth_mode": service.settings.auth_mode,
            "data_backend": service.settings.data_backend,
            "ai_enabled": service.settings.ai_enabled,
            "ai_provider": "Cloudflare Workers AI",
            "ai_model": service.settings.cloudflare_model,
            "ocr_enabled": service.settings.ocr_enabled,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "max_upload_mb": service.settings.max_upload_bytes // (1024 * 1024),
            "admin_emails": [e.strip() for e in getattr(service.settings, "admin_emails", "").split(",") if e.strip()],
        }

    def route_tag(path):
        if path == "/api/v1/health":
            return "Diagnostics"
        if path.startswith("/api/v1/auth/"):
            return "Authentication"
        if path.startswith("/api/v1/me"):
            return "Profile"
        if path.startswith("/api/v1/workspace"):
            return "Workspace"
        if path.startswith("/api/v1/notebooks"):
            if "/sources" in path:
                return "Sources"
            if "/notes" in path or "/conversation" in path or path.endswith(("/messages", "/generations", "/artifacts", "/jobs", "/mind-map", "/decks", "/quizzes")):
                if "/notes" in path:
                    return "Notes"
                if "/jobs" in path:
                    return "Jobs"
                return "Study Tools"
            return "Notebooks"
        if path.startswith("/api/v1/sources"):
            return "Sources"
        if path.startswith("/api/v1/jobs"):
            return "Jobs"
        if path.startswith("/api/v1/notes") or path.endswith("/save-note"):
            return "Notes"
        if path.startswith(("/api/v1/decks", "/api/v1/quizzes", "/api/v1/attempts", "/api/v1/search", "/api/v1/ai/")) or path.endswith(("/artifacts", "/mind-map")) or path.startswith("/api/v1/messages"):
            return "Study Tools"
        if path.startswith(("/api/v1/focus-sessions", "/api/v1/tasks")):
            return "Focus"
        if path.startswith("/api/v1/feedback"):
            return "Feedback"
        if path.startswith("/api/v1/admin/"):
            return "Admin"
        return "Workspace"

    for route in app.routes:
        if getattr(route, "path", "").startswith("/api/v1/") and hasattr(route, "tags"):
            route.tags = [route_tag(route.path)]

    return app


app = create_app()
