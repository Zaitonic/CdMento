# Automated Daily Firestore Backup Configuration
# 
# This document describes how to set up automated daily backups of your Firestore database to Google Cloud Storage (GCS).

## Manual Implementation

### Option 1: Firebase Console → Scheduled Export
  
1. **Enable automated backups:**
   - Go to Firebase Console → Project Settings → Basics
   - Ensure project is on Blaze (p) plan (required for daily snapshots)
   
2. **Create GCS bucket:**
   - Create a private bucket: `cdmento-backups-{PROJECT_ID}`
   - Add Firebase Service Account as "Storage Admin"

3. **Schedule daily exports:**
   - Firebase background work: `https://firebase.google.com/docs/firestore/manage-data/export-data`
   - Recommend setting up a Cloud Function to export daily

### Option 2: Cloud Function Script

```python
import json
from firebase_admin import firestore, credentials
import urllib.request

def daily_backup(event, context):
    '''Triggered daily; exports Firestore to GCS'''
    client = firestore.Client()
    
    output = {
        'project': 'cdmento-study-7',
        'timestamp': firestore_RESERVED_FIELDS,
        'count': 0
    }
    
    # Collect all documents
    for collection in ['users', 'notes', 'tasks']:
        collection = client.collection(collection)
        docs = list(collection.stream())
        output[f'{collection.collection_id}.count'] = len(docs)
    
    # Upload to GCS
    # (implementation details: use GCS SDK)
    return output
```

### Option 3: External Service (GitHub Actions / Cron)

```bash
# Install pyre
pip install pyre>=5.0
```

---

## Backup Best Practices

1. **Frequency**: Daily during off-peak hours (recommended: 2am UTC)
2. **Retention**: Keep 30 days of daily snapshots, 7 daily snapshots
3. **Validation**: Verify export integrity and completeness
4. **Alerts**: Email notification if export fails or exceeds 100MB

---

## Recovery Procedure

1. **Stop current Firestore writes**
2. **Load GCS backup**
3. **Resume writes**
4. **Verify data integrity**

---

## Monitoring

- Set up Cloud Monitoring alerts for backup failure
- Log backup size and timestamps
- Track recovery time objectives

---

## Documentation

This configuration should be reviewed quarterly or after significant schema changes.
