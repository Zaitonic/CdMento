# Google-only account sign-in

CdMento supports both direct Google sign-in and email/password accounts through its FastAPI backend. Google sign-in uses Google Identity Services and verifies Google's ID token on the server. Email/password accounts use CdMento's password hashing and session storage; Brevo sends account verification and password reset links. Firebase Authentication is not required in `AUTH_MODE=google`.

## Google OAuth setup

In Google Cloud Console, create an OAuth client with application type **Web application**. Add `http://localhost:5173` to Authorized JavaScript origins for local development, plus the deployed website origin when available. Google requires an OAuth client ID and an authorized origin for the Sign In With Google button. See [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Add the same web client ID to the private root `.env`:

```env
AUTH_MODE=google
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
BREVO_API_KEY=your-private-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=CdMento
APP_BASE_URL=http://127.0.0.1:5173
```

In Brevo, activate transactional email and verify the sender address or domain first. Keep `BREVO_API_KEY` private. Restart the backend and Vite after saving `.env`. The Google client ID is public app configuration; no Google client secret is used by this sign-in flow.

## Account behavior

- Google verifies the account; CdMento verifies the returned ID token against the configured client ID and requires a verified email.
- Email/password signups must verify their email before they can sign in. Verification and reset tokens are one-time, expire, and are stored hashed.
- Passwords are stored as salted scrypt hashes. Reset requests use a neutral response to avoid revealing whether an account exists.
- CdMento then issues its own revocable session token. `Keep me signed in` controls a 12-hour or 30-day session.
- Password recovery for Google accounts is handled by [Google Account Recovery](https://accounts.google.com/signin/recovery).
- `DATA_BACKEND=sqlite` remains the default local storage. Google sign-in does not itself move study records to Google Cloud or Firestore.
