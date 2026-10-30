# Firebase rules

`firestore.rules` and `storage.rules` deny direct browser access to account-owned application data. The Python API uses Firebase Admin and server IAM when cloud mode is configured. These rules were moved here without changing their access behavior.

Local SQLite/demo mode does not require deploying these files. See the root README before configuring Firebase. No cloud deployment or permissions change is performed by reorganizing this folder.
