import sys
import types

from backend.storage import FileStorage


class _Result:
    body = b"stored bytes"


def _install(monkeypatch, blob_module, sync_module=None):
    package = types.ModuleType("vercel")
    package.__path__ = []
    package.blob = blob_module
    blob_module.__path__ = []
    if sync_module is not None:
        blob_module.sync = sync_module
    monkeypatch.setitem(sys.modules, "vercel", package)
    monkeypatch.setitem(sys.modules, "vercel.blob", blob_module)


def test_vercel_blob_prefers_the_synchronous_api(monkeypatch, tmp_path):
    calls = []
    sync = types.ModuleType("vercel.blob.sync")
    sync.put_blob = lambda key, data, **options: calls.append(
        ("put", key, data, options)
    )
    sync.get_blob = lambda key, **options: (
        calls.append(("get", key, options)) or _Result()
    )
    sync.delete_blob = lambda key: calls.append(("delete", key))
    _install(monkeypatch, types.ModuleType("vercel.blob"), sync)
    monkeypatch.setitem(sys.modules, "vercel.blob.sync", sync)

    storage = FileStorage(tmp_path, use_vercel_blob=True)
    storage.put("tmp/parts/0", b"page data", "application/pdf")
    assert storage.get("tmp/parts/0") == b"stored bytes"
    storage.delete("tmp/parts/0")

    assert [call[0] for call in calls] == ["put", "get", "delete"]
    assert calls[0][3] == {
        "access": "private",
        "content_type": "application/pdf",
        "allow_overwrite": True,
    }
    assert calls[1][2] == {"access": "private"}


def test_vercel_blob_awaits_the_async_api_when_no_sync_module_exists(
    monkeypatch, tmp_path
):
    calls = []

    async def put_blob(key, data, **options):
        calls.append(("put", key, data, options))

    async def get_blob(key, **options):
        calls.append(("get", key, options))
        return _Result()

    async def delete_blob(key):
        calls.append(("delete", key))

    blob = types.ModuleType("vercel.blob")
    blob.put_blob = put_blob
    blob.get_blob = get_blob
    blob.delete_blob = delete_blob
    _install(monkeypatch, blob)

    storage = FileStorage(tmp_path, use_vercel_blob=True)
    storage.put("tmp/parts/0", b"page data")
    assert storage.get("tmp/parts/0") == b"stored bytes"
    storage.delete("tmp/parts/0")

    assert [call[0] for call in calls] == ["put", "get", "delete"]


def test_local_storage_round_trip(tmp_path):
    storage = FileStorage(tmp_path)
    storage.put("users/a/sources/1/original.docx", b"docx bytes")
    assert storage.get("users/a/sources/1/original.docx") == b"docx bytes"
    storage.delete("users/a/sources/1/original.docx")
    assert not storage.local_path("users/a/sources/1/original.docx").exists()
