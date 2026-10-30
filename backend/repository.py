"""Owner-scoped records with compare-and-swap updates in SQLite or Firestore."""

import copy
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


class Conflict(Exception):
    pass


class Repository:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "cdmento.sqlite3"
        self.lock = threading.RLock()
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS records (owner TEXT, kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(owner,kind,id))"
            )

    @contextmanager
    def connection(self):
        with self.lock, sqlite3.connect(self.path, timeout=30) as db:
            yield db

    def get(self, owner, kind, identifier):
        with self.connection() as db:
            row = db.execute(
                "SELECT body FROM records WHERE owner=? AND kind=? AND id=?",
                (owner, kind, identifier),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, owner, kind):
        with self.connection() as db:
            rows = db.execute(
                "SELECT body FROM records WHERE owner=? AND kind=? ORDER BY rowid",
                (owner, kind),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def all_jobs(self):
        with self.connection() as db:
            rows = db.execute(
                "SELECT owner,body FROM records WHERE kind='jobs'"
            ).fetchall()
        return [(owner, json.loads(body)) for owner, body in rows]

    def put(self, owner, kind, value, expected=None):
        value = copy.deepcopy(value)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT body FROM records WHERE owner=? AND kind=? AND id=?",
                (owner, kind, value["id"]),
            ).fetchone()
            current = json.loads(row[0]) if row else None
            revision = current.get("revision", 0) if current else 0
            if expected is not None and expected != revision:
                raise Conflict(
                    "This record changed. Reload before saving your changes."
                )
            value["revision"] = revision + 1
            db.execute(
                "INSERT OR REPLACE INTO records VALUES (?,?,?,?)",
                (owner, kind, value["id"], json.dumps(value)),
            )
        return value

    def delete(self, owner, kind, identifier):
        with self.connection() as db:
            db.execute(
                "DELETE FROM records WHERE owner=? AND kind=? AND id=?",
                (owner, kind, identifier),
            )


class FirestoreRepository:
    def __init__(self, db, bucket):
        self.db, self.bucket = db, bucket

    def collection(self, owner, kind):
        return self.db.collection("users").document(owner).collection(kind)

    def decode(self, data):
        if data and "_blob" in data:
            return json.loads(self.bucket.blob(data["_blob"]).download_as_bytes())
        return data

    def get(self, owner, kind, identifier):
        snapshot = self.collection(owner, kind).document(identifier).get()
        return self.decode(snapshot.to_dict()) if snapshot.exists else None

    def list(self, owner, kind):
        return [
            self.decode(item.to_dict())
            for item in self.collection(owner, kind).stream()
        ]

    def all_jobs(self):
        return [
            (item.reference.parent.parent.id, self.decode(item.to_dict()))
            for item in self.db.collection_group("jobs").stream()
        ]

    def put(self, owner, kind, value, expected=None):
        from google.cloud import firestore

        reference = self.collection(owner, kind).document(value["id"])
        value = copy.deepcopy(value)
        # Large extracted text and graph payloads belong in private object storage.
        blob_path = None
        if len(json.dumps(value).encode()) > 150_000:
            blob_path = f"users/{owner}/records/{kind}/{value['id']}/{uuid4()}.json"
        transaction = self.db.transaction()

        @firestore.transactional
        def write(tx):
            snap = reference.get(transaction=tx)
            previous = snap.to_dict() if snap.exists else {}
            revision = previous.get("revision", 0)
            if expected is not None and revision != expected:
                raise Conflict(
                    "This record changed. Reload before saving your changes."
                )
            value["revision"] = revision + 1
            if blob_path:
                self.bucket.blob(blob_path).upload_from_string(
                    json.dumps(value), content_type="application/json"
                )
                tx.set(
                    reference,
                    {
                        "id": value["id"],
                        "revision": value["revision"],
                        "_blob": blob_path,
                    },
                )
            else:
                tx.set(reference, value)
            return previous.get("_blob")

        try:
            previous_blob = write(transaction)
        except Exception:
            if blob_path:
                self.bucket.blob(blob_path).delete()
            raise
        if previous_blob and previous_blob != blob_path:
            self.bucket.blob(previous_blob).delete()
        return value

    def delete(self, owner, kind, identifier):
        ref = self.collection(owner, kind).document(identifier)
        snapshot = ref.get()
        if snapshot.exists and snapshot.to_dict().get("_blob"):
            self.bucket.blob(snapshot.to_dict()["_blob"]).delete()
        ref.delete()
