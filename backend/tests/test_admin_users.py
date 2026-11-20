"""Admin Users listing must merge every account source, not just profiles."""

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app, user
from backend.repository import Repository
from backend.services import Services
from backend.storage import FileStorage


class FakeAI:
    client = None

    def require(self):
        pass


@pytest.fixture
def env(tmp_path):
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        worker_enabled=False,
        auth_mode="local",
        data_backend="sqlite",
        admin_emails="boss@example.com",
    )
    services = Services(config, Repository(tmp_path), FileStorage(tmp_path), FakeAI())
    repo = services.repo
    repo.put(
        "admin-user",
        "profile",
        {
            "id": "account",
            "email": "boss@example.com",
            "display_name": "Boss",
            "role": "admin",
            "created_at": "2026-01-01T00:00:00+00:00",
        },
    )
    # Google accounts: one has a profile document, one was created before
    # profile upserts existed (or after a failed write) and must still show.
    repo.put(
        "__google_auth__",
        "accounts",
        {
            "id": "google_a",
            "email": "a@example.com",
            "display_name": "Account A",
            "email_verified": True,
            "created_at": 100,
        },
    )
    repo.put(
        "__google_auth__",
        "accounts",
        {
            "id": "google_b",
            "email": "b@example.com",
            "display_name": "Account B",
            "email_verified": True,
            "created_at": 200,
        },
    )
    repo.put(
        "google_a",
        "profile",
        {
            "id": "account",
            "email": "a@example.com",
            "display_name": "Account A",
            "provider": "google",
            "role": "student",
            "created_at": "2026-01-02T00:00:00+00:00",
        },
    )
    # A signup that has not verified/logged in yet has no profile document.
    repo.put(
        "__email_password_auth__",
        "accounts",
        {
            "id": "hash-c",
            "uid": "email_hash-c",
            "email": "c@example.com",
            "display_name": "Account C",
            "email_verified": False,
        },
    )
    app = create_app(services=services)

    def identity(request: Request):
        return request.headers.get("X-Test-User", "admin-user")

    app.dependency_overrides[user] = identity
    with TestClient(app) as client:
        yield client, services


def test_users_merge_accounts_without_profile_documents(env):
    client, _ = env
    response = client.get("/api/v1/admin/users")
    assert response.status_code == 200, response.text
    data = response.json()
    by_uid = {item["uid"]: item for item in data["items"]}

    assert {"google_a", "google_b", "email_hash-c"} <= set(by_uid)
    assert data["total"] >= 3
    assert data["warnings"] == []

    # Profile-less accounts are not dropped and keep their provider.
    assert by_uid["google_b"]["provider"] == "google"
    assert by_uid["google_b"]["display_name"] == "Account B"
    assert by_uid["google_b"]["sources"] == ["google-auth"]
    assert by_uid["email_hash-c"]["provider"] == "email"
    assert by_uid["email_hash-c"]["email_verified"] is False
    assert by_uid["google_a"]["sources"] == ["google-auth", "profile"]


def test_role_update_creates_profile_for_profileless_account(env):
    client, services = env
    response = client.patch(
        "/api/v1/admin/users/google_b/role", json={"role": "admin"}
    )
    assert response.status_code == 200
    profile = services.repo.get("google_b", "profile", "account")
    assert profile["role"] == "admin"
    assert profile["email"] == "b@example.com"

    listed = client.get("/api/v1/admin/users?role=admin").json()
    assert "google_b" in {item["uid"] for item in listed["items"]}


def test_disabling_account_updates_registry_and_filters(env):
    client, services = env
    response = client.patch(
        "/api/v1/admin/users/google_b/status", json={"disabled": True}
    )
    assert response.status_code == 200
    account = services.repo.get("__google_auth__", "accounts", "google_b")
    assert account["disabled"] is True

    disabled = client.get("/api/v1/admin/users?status=disabled").json()
    assert [item["uid"] for item in disabled["items"]] == ["google_b"]

    active = client.get("/api/v1/admin/users?status=active").json()
    assert "google_b" not in {item["uid"] for item in active["items"]}
