from pathlib import Path


class FileStorage:
    def __init__(self, directory: Path, bucket=None):
        self.root = (directory / "uploads").resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.bucket = bucket

    def local_path(self, key):
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid storage key")
        return path

    def put(self, key, data, content_type="application/octet-stream"):
        if self.bucket:
            self.bucket.blob(key).upload_from_string(data, content_type=content_type)
        else:
            path = self.local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def get(self, key):
        return (
            self.bucket.blob(key).download_as_bytes()
            if self.bucket
            else self.local_path(key).read_bytes()
        )

    def delete(self, key):
        if self.bucket:
            blob = self.bucket.blob(key)
            if blob.exists():
                blob.delete()
        else:
            self.local_path(key).unlink(missing_ok=True)
