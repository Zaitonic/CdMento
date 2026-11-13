import hashlib
import re
import time
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.password_auth import AUTH_OWNER, PasswordAuth
from backend.repository import Repository


@pytest.fixture
def auth(tmp_path):
    return PasswordAuth(Repository(tmp_path), Mock(), "http://127.0.0.1:5173")


def last_token(auth):
    return re.search(r"token=([^\s]+)", auth.mailer.send.call_args.args[3]).group(1)


def test_verify_reset_and_session_revocation(auth):
    auth.signup("student@example.com", "original-password", "Student", "test")
    token = last_token(auth)
    with pytest.raises(HTTPException) as unverified:
        auth.login("student@example.com", "original-password", "test", False)
    assert unverified.value.status_code == 403
    auth.verify_email(token)
    with pytest.raises(HTTPException):
        auth.verify_email(token)
    session = auth.login("student@example.com", "original-password", "test", False)
    auth.request_reset("student@example.com", "test")
    reset = last_token(auth)
    auth.reset_password(reset, "replacement-password")
    with pytest.raises(HTTPException):
        auth.reset_password(reset, "another-password")
    with pytest.raises(HTTPException):
        auth.resolve(session["token"])
    with pytest.raises(HTTPException):
        auth.login("student@example.com", "original-password", "test", False)
    assert auth.login("student@example.com", "replacement-password", "test", False)["profile"]["emailVerified"]


def test_failed_delivery_preserves_previous_link(auth):
    auth.signup("student@example.com", "original-password", "Student", "test")
    token = last_token(auth)
    auth.mailer.send.side_effect = RuntimeError("Delivery unavailable")
    with pytest.raises(RuntimeError):
        auth.signup("student@example.com", "original-password", "Student", "test")
    auth.verify_email(token)


def test_expired_link_and_unknown_reset(auth):
    auth.signup("student@example.com", "original-password", "Student", "test")
    token = last_token(auth)
    identifier = hashlib.sha256(token.encode()).hexdigest()
    action = auth.repo.get(AUTH_OWNER, "actions", identifier)
    auth.repo.put(AUTH_OWNER, "actions", {**action, "expires_at": time.time() - 1})
    with pytest.raises(HTTPException):
        auth.verify_email(token)
    auth.mailer.reset_mock()
    assert "If an account exists" in auth.request_reset("unknown@example.com", "test")["message"]
    auth.mailer.send.assert_not_called()


def test_google_user_cannot_create_duplicate_password_account(auth):
    auth.repo.put("__google_auth__", "accounts", {"id": "google_user", "email": "student@example.com"})
    with pytest.raises(HTTPException) as error:
        auth.signup("STUDENT@example.com", "original-password", "Student", "test")
    assert error.value.status_code == 409
    assert auth.repo.list(AUTH_OWNER, "accounts") == []
    auth.mailer.send.assert_not_called()
