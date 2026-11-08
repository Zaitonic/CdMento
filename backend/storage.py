from pathlib import Path


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
            from vercel.blob import put_blob

            put_blob(
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
            from vercel.blob import get_blob

            return get_blob(key, access="private").body
        return self.local_path(key).read_bytes()

    def delete(self, key):
        if self.bucket:
            blob = self.bucket.blob(key)
            if blob.exists():
                blob.delete()
        elif self.use_vercel_blob:
            from vercel.blob import delete_blob

            delete_blob(key)
        else:
            self.local_path(key).unlink(missing_ok=True)
