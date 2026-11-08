# Google-only account sign-in

CdMento's direct Google sign-in uses Google Identity Services in the browser and verifies Google's ID token in the FastAPI backend. It does not use Firebase Authentication or a Firebase service-account key.

## Google OAuth setup

In Google Cloud Console, create an OAuth client with application type **Web application**. Add `http://localhost:5173` to Authorized JavaScript origins for local development, plus the deployed website origin when available. Google requires an OAuth client ID and an authorized origin for the Sign In With Google button. See [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Add the same web client ID to the private root `.env`:

```env
AUTH_MODE=google
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Restart the backend and Vite after saving `.env`. The client ID is public app configuration; no Google client secret is used by this sign-in flow.

## Account behavior

- Google verifies the account; CdMento verifies the returned ID token against the configured client ID and requires a verified email.
- CdMento then issues its own revocable session token. `Keep me signed in` controls a 12-hour or 30-day session.
- Password recovery for Google accounts is handled by [Google Account Recovery](https://accounts.google.com/signin/recovery).
- `DATA_BACKEND=sqlite` remains the default local storage. Google sign-in does not itself move study records to Google Cloud or Firestore.
