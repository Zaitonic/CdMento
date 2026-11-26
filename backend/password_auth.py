"""Email/password accounts with one-time email verification and reset links."""

import base64
import hashlib
import hmac
import html
import secrets
import threading
import time
from collections import defaultdict, deque
from urllib.parse import quote

import bcrypt
from fastapi import HTTPException
from .repository import Conflict


AUTH_OWNER = "__email_password_auth__"
GOOGLE_AUTH_OWNER = "__google_auth__"


class PasswordAuth:
    def __init__(self, repo, mailer, app_base_url):
        self.repo = repo
        self.mailer = mailer
        self.app_base_url = app_base_url.rstrip("/")
        self.attempts = defaultdict(deque)
        self.lock = threading.RLock()

    @staticmethod
    def email_id(email):
        return hashlib.sha256(email.strip().casefold().encode()).hexdigest()

    def account(self, email):
        """The stored account for an email, if one exists (admin listing/signup)."""
        return self.repo.get(AUTH_OWNER, "accounts", self.email_id(email))

    @staticmethod
    def _scrypt_hash(password, salt):
        return hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32
        ).hex()

    @staticmethod
    def password_hash(password, salt):
        """bcrypt hash. The salt is embedded in the bcrypt string; the stored
        hex salt is kept only for legacy migration bookkeeping."""
        return base64.b64encode(
            bcrypt.hashpw(password.encode(), bcrypt.gensalt())
        ).decode()

    def _verify_and_migrate(self, account, password):
        """Verify a password, transparently migrating legacy scrypt hashes to bcrypt."""
        stored = account.get("password_hash", "")
        is_bcrypt = account.get("alg") == "bcrypt"
        if not is_bcrypt:
            candidate = self._scrypt_hash(password, account.get("salt", "00" * 16))
            if not hmac.compare_digest(candidate, stored):
                return False
            # Migrate to bcrypt on successful legacy login.
            self.repo.put(
                AUTH_OWNER,
                "accounts",
                {
                    **account,
                    "password_hash": self.password_hash(password, account.get("salt")),
                    "alg": "bcrypt",
                },
            )
            return True
        try:
            return bcrypt.checkpw(
                password.encode(), base64.b64decode(stored)
            )
        except (ValueError, TypeError):
            return False

    def _throttle(self, key, limit, seconds, message):
        now = time.time()
        with self.lock:
            attempts = self.attempts[key]
            while attempts and now - attempts[0] > seconds:
                attempts.popleft()
            if len(attempts) >= limit:
                raise HTTPException(429, message)
            attempts.append(now)

    def _new_action(self, account, action, lifetime):
        token = secrets.token_urlsafe(32)
        self.repo.put(
            AUTH_OWNER,
            "actions",
            {
                "id": hashlib.sha256(token.encode()).hexdigest(),
                "uid": account["uid"],
                "action": action,
                "expires_at": time.time() + lifetime,
            },
        )
        return token

    def _google_account_exists(self, email):
        return any(
            item.get("email", "").casefold() == email
            for item in self.repo.list(GOOGLE_AUTH_OWNER, "accounts")
        )

    def _send_action(self, account, action):
        previous = [item for item in self.repo.list(AUTH_OWNER, "actions")
                    if item["uid"] == account["uid"] and item["action"] == action]
        token = self._new_action(account, action, 24 * 3600 if action == "verify" else 3600)
        mode = "verifyEmail" if action == "verify" else "resetPassword"
        link = f"{self.app_base_url}/auth/action?mode={mode}&token={quote(token)}"
        label = "Verify your email" if action == "verify" else "Reset your password"
        escaped_link = html.escape(link, quote=True)
        escaped_name = html.escape(account["display_name"])
        self.mailer.send(
            account["email"],
            f"{label} — CdMento",
            f"<p>Hi {escaped_name},</p><p>Use this one-time link to {label.lower()}:</p>"
            f'<p><a href="{escaped_link}">{label}</a></p><p>If you did not request this, you can ignore this email.</p>',
            f"Hi {account['display_name']},\n\n{label}: {link}\n\n"
            "If you did not request this, you can ignore this email.",
        )
        # Keep earlier links usable when delivery fails or times out.
        for item in previous:
            self.repo.delete(AUTH_OWNER, "actions", item["id"])

    def signup(self, email, password, name, client):
        self._throttle(("signup", client), 8, 600, "Too many requests. Please wait ten minutes.")
        email = email.strip().casefold()
        account_id = self.email_id(email)
        account = self.repo.get(AUTH_OWNER, "accounts", account_id)
        if account:
            if not account["email_verified"]:
                self._send_action(account, "verify")
            return {"message": "If this email can be registered, check your inbox for next steps."}
        # Do not create a duplicate password account for an email already owned
        # by Google sign-in. The check is silent: the caller sees the same
        # generic message either way, so account enumeration is prevented.
        if self._google_account_exists(email):
            return {"message": "If this email can be registered, check your inbox for next steps."}
        salt = secrets.token_hex(16)
        account = {
            "id": account_id,
            "uid": "email_" + account_id,
            "email": email,
            "display_name": name.strip(),
            "email_verified": False,
            "salt": salt,
            "password_hash": self.password_hash(password, salt),
            "alg": "bcrypt",
        }
        self.repo.put(AUTH_OWNER, "accounts", account)
        self._send_action(account, "verify")
        return {"message": "If this email can be registered, check your inbox for next steps."}

    def login(self, email, password, client, remember):
        self._throttle(("login", client), 10, 600, "Too many sign-in attempts. Please wait ten minutes.")
        email = email.strip().casefold()
        account = self.repo.get(AUTH_OWNER, "accounts", self.email_id(email))
        if not account:
            raise HTTPException(401, "The email or password is incorrect. Please try again.")
        if not self._verify_and_migrate(account, password):
            raise HTTPException(401, "The email or password is incorrect. Please try again.")
        if not account["email_verified"]:
            raise HTTPException(403, "Verify your email using the link we sent before signing in.")
        if account.get("disabled"):
            raise HTTPException(403, "This account has been disabled. Contact the CdMento administrator.")
        with self.lock:
            self.attempts[("login", client)].clear()
        token = "account_" + secrets.token_urlsafe(32)
        self.repo.put(
            AUTH_OWNER,
            "sessions",
            {
                "id": hashlib.sha256(token.encode()).hexdigest(),
                "uid": account["uid"],
                "expires_at": time.time() + (30 * 86400 if remember else 12 * 3600),
            },
        )
        return {"token": token, "profile": self.profile(account["uid"])}

    def profile(self, uid):
        account_id = uid.removeprefix("email_")
        account = self.repo.get(AUTH_OWNER, "accounts", account_id)
        if not account:
            raise HTTPException(401, "Your account could not be loaded. Please sign in again.")
        return {
            "uid": uid,
            "email": account["email"],
            "displayName": account["display_name"],
            "emailVerified": account["email_verified"],
            "kind": "password",
        }

    def resolve(self, token):
        session = self.repo.get(
            AUTH_OWNER, "sessions", hashlib.sha256(token.encode()).hexdigest()
        )
        if not session or session["expires_at"] <= time.time():
            raise HTTPException(401, "Your session expired. Please sign in again.")
        profile = self.profile(session["uid"])
        return {
            "uid": session["uid"],
            "email": profile["email"],
            "name": profile["displayName"],
            "email_verified": profile["emailVerified"],
        }

    def verify_email(self, token):
        return self._consume_action(token, "verify")

    def request_reset(self, email, client):
        self._throttle(("reset", client), 5, 600, "Too many requests. Please wait ten minutes.")
        email = email.strip().casefold()
        account = self.repo.get(AUTH_OWNER, "accounts", self.email_id(email))

        if account:
            # Send to unverified accounts too: a link delivered to the mailbox is
            # the same proof of ownership that verification asks for, so resetting
            # also verifies the address. Otherwise a forgotten password on a
            # never-verified signup could never be recovered.
            self._send_action(account, "reset")
        # Do not confirm whether the email exists or belongs to a Google account.
        # Always return the same message regardless of the account's state.
        return {"message": "If an account exists for this email, reset instructions will be sent."}

    def reset_password(self, token, password):
        uid = self._consume_action(token, "reset")
        account_id = uid.removeprefix("email_")
        account = self.repo.get(AUTH_OWNER, "accounts", account_id)
        if not account:
            raise HTTPException(400, "This link is invalid or expired. Request a new one.")
        salt = secrets.token_hex(16)
        self.repo.put(
            AUTH_OWNER,
            "accounts",
            {
                **account,
                "salt": salt,
                "password_hash": self.password_hash(password, salt),
                    "alg": "bcrypt",
                # Opening a link delivered to the mailbox proves ownership.
                "email_verified": True,
            },
        )
        for session in self.repo.list(AUTH_OWNER, "sessions"):
            if session["uid"] == uid:
                self.repo.delete(AUTH_OWNER, "sessions", session["id"])
        for action in self.repo.list(AUTH_OWNER, "actions"):
            if action["uid"] == uid and action["action"] == "reset":
                self.repo.delete(AUTH_OWNER, "actions", action["id"])

    def _consume_action(self, token, expected):
        action_id = hashlib.sha256(token.encode()).hexdigest()
        action = self.repo.get(AUTH_OWNER, "actions", action_id)
        if not action or action.get("consumed") or action["action"] != expected or action["expires_at"] <= time.time():
            raise HTTPException(400, "This link is invalid or expired. Request a new one.")
        try:
            self.repo.put(AUTH_OWNER, "actions", {**action, "consumed": True}, expected=action["revision"])
        except Conflict:
            raise HTTPException(400, "This link is invalid or expired. Request a new one.") from None
        self.repo.delete(AUTH_OWNER, "actions", action_id)
        if expected == "verify":
            account_id = action["uid"].removeprefix("email_")
            account = self.repo.get(AUTH_OWNER, "accounts", account_id)
            if not account:
                raise HTTPException(400, "This link is invalid or expired. Request a new one.")
            self.repo.put(AUTH_OWNER, "accounts", {**account, "email_verified": True})
        return action["uid"]

    def logout(self, token):
        self.repo.delete(
            AUTH_OWNER, "sessions", hashlib.sha256(token.encode()).hexdigest()
        )
