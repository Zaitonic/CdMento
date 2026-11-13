from backend.repository import firestore_id


def test_firestore_reserved_ids_are_encoded_but_normal_ids_are_kept():
    assert firestore_id("google_abc123") == "google_abc123"
    encoded = firestore_id("__google_auth__")
    assert encoded.startswith("enc_")
    assert firestore_id(encoded) == encoded
