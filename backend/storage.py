import asyncio
import inspect
from pathlib import Path


def _blob_api():
    """Return the blocking Vercel Blob functions.

    vercel-blob 0.5 moved the async calls to the package root and kept the
    blocking calls under ``vercel.blob.sync``. Older releases only exposed the
    blocking functions at the root. Accept both so uploads keep working across
    the supported version range.
    """
    try:
        from vercel.blob import sync

        if all(
            hasattr(sync, name) for name in ("put_blob", "get_blob", "delete_blob")
        ):
            return sync
    except ImportError:
        pass
    from vercel import blob

    return blob


def _blob_call(name, *args, **kwargs):
    result = getattr(_blob_api(), name)(*args, **kwargs)
    if inspect.isawaitable(result):
        return asyncio.run(result)
    return result


class FileStorage:
    def __init__(self, directory: Path, bucket=None, use_vercel_blob=False):
        self.root = (directory / "uploads").resolve()
        if not bucket and not use_vercel_blob:
            self.root.mkdir(parents=True, exist_ok=True)
        self.bucket = bucket
        self.use_vercel_blob = use_vercel_blob

    def local_path(self, key):
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid storage key")
        return path

    def put(self, key, data, content_type="application/octet-stream"):
        if self.bucket:
            self.bucket.blob(key).upload_from_string(data, content_type=content_type)
        elif self.use_vercel_blob:
            _blob_call(
                "put_blob",
                key,
                data,
                access="private",
                content_type=content_type,
                allow_overwrite=True,
            )
        else:
            path = self.local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def get(self, key):
        if self.bucket:
            return self.bucket.blob(key).download_as_bytes()
        if self.use_vercel_blob:
            return _blob_call("get_blob", key, access="private").body
        return self.local_path(key).read_bytes()

    def delete(self, key):
        if self.bucket:
            blob = self.bucket.blob(key)
            if blob.exists():
                blob.delete()
        elif self.use_vercel_blob:
            _blob_call("delete_blob", key)
        else:
            self.local_path(key).unlink(missing_ok=True)
