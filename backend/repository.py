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
        if data and "_chunk_id" in data:
            chunks = (
                self.db.collection("record_payloads")
                .document(data["_chunk_id"])
                .collection("parts")
                .stream()
            )
            parts = sorted(chunks, key=lambda item: item.to_dict()["index"])
            return json.loads("".join(item.to_dict()["text"] for item in parts))
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
        # Firestore free-tier projects can store large records in private chunks.
        blob_path = None
        chunk_id = None
        encoded = json.dumps(value, ensure_ascii=False)
        if len(encoded.encode()) > 150_000 and self.bucket:
            blob_path = f"users/{owner}/records/{kind}/{value['id']}/{uuid4()}.json"
        elif len(encoded.encode()) > 150_000:
            chunk_id = str(uuid4())
            payloads = [
                encoded[i : i + 600_000]
                for i in range(0, len(encoded), 600_000)
            ]
            parts = (
                self.db.collection("record_payloads")
                .document(chunk_id)
                .collection("parts")
            )
            for index, text in enumerate(payloads):
                parts.document(f"{index:04d}").set(
                    {"index": index, "text": text}
                )
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
            elif chunk_id:
                tx.set(
                    reference,
                    {
                        "id": value["id"],
                        "revision": value["revision"],
                        "_chunk_id": chunk_id,
                        "_chunk_count": len(payloads),
                    },
                )
            else:
                tx.set(reference, value)
            return previous.get("_blob"), previous.get("_chunk_id")

        try:
            previous_blob, previous_chunk = write(transaction)
        except Exception:
            if blob_path:
                self.bucket.blob(blob_path).delete()
            if chunk_id:
                self.db.collection("record_payloads").document(chunk_id).delete()
                for part in (
                    self.db.collection("record_payloads")
                    .document(chunk_id)
                    .collection("parts")
                    .stream()
                ):
                    part.reference.delete()
            raise
        if previous_blob and previous_blob != blob_path:
            self.bucket.blob(previous_blob).delete()
        if previous_chunk and previous_chunk != chunk_id:
            parts = (
                self.db.collection("record_payloads")
                .document(previous_chunk)
                .collection("parts")
            )
            for part in parts.stream():
                part.reference.delete()
            self.db.collection("record_payloads").document(previous_chunk).delete()
        return value

    def delete(self, owner, kind, identifier):
        ref = self.collection(owner, kind).document(identifier)
        snapshot = ref.get()
        if snapshot.exists:
            data = snapshot.to_dict()
            if data.get("_blob"):
                self.bucket.blob(data["_blob"]).delete()
            if data.get("_chunk_id"):
                chunks = (
                    self.db.collection("record_payloads")
                    .document(data["_chunk_id"])
                )
                for part in chunks.collection("parts").stream():
                    part.reference.delete()
                chunks.delete()
        ref.delete()
