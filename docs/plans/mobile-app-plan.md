# CdMento Mobile App Plan

Status: Draft for approval  
Date: 27 October 2026  
Decisions: Capacitor hybrid, Firebase production backend, online-first cache, Android first

## 1. Goal

Ship CdMento as a secure Android app first, using the existing React 19 + Vite frontend inside a Capacitor native shell and the existing FastAPI backend as the secure API/AI/OCR layer. Add iOS after Android is stable.

This is not a React Native rewrite. The current UI, study features, and backend logic are reused.

## 2. Decisions

| Area | Decision |
| --- | --- |
| Mobile framework | Capacitor with native Android/iOS shells |
| Accounts | Firebase Authentication |
| Database | Firestore |
| File storage | Firebase Cloud Storage |
| API | Existing FastAPI, deployed to Cloud Run or equivalent |
| AI/OCR | Keep server-side only; no provider keys in the app |
| Offline | Online-first: encrypted read cache and offline banner; mutations require a connection |
| First platform | Android (Google Play) |
| Later platform | iOS (App Store), after Android is stable |
| Profile | Private profile with editable display name, avatar, bio, daily study goal, and appearance |
| Local demo mode | Development only; never included in a production build |

## 3. Target architecture

```text
React 19 + Vite
  | Capacitor bridge
  +-- Android app (WebView + native plugins)
  |     +-- native Firebase Auth
  |     +-- Android Keystore for cache key
  |     +-- native file/photo picker / share / status bar
  |
  | HTTPS + Firebase ID token + App Check
  v
FastAPI API (Cloud Run)
  +-- Firebase Admin token verification
  +-- App Check verification
  +-- Firestore access (Admin SDK)
  +-- Cloud Storage access (private originals and avatars)
  +-- AI gateway (server-side keys)
  +-- Redis queue for OCR/extraction/AI jobs

Firebase
  +-- Authentication
  +-- Firestore
  +-- Cloud Storage
  +-- App Check (Play Integrity)
```

### Trust boundaries

1. The mobile app is untrusted. It must never receive AI provider keys, service-account credentials, or another user's data.
2. Every API request must prove both identity and app authenticity.
3. Firestore and Storage deny direct client access. All application reads/writes go through FastAPI.
4. Files are private and served through short-lived, owner-scoped downloads.
5. AI output is untrusted content and is never executed or treated as a command.

## 4. Scope

### Android v1

- Native app shell and launcher.
- Email/password and Google sign-in.
- Email verification and password reset.
- Notebooks, sources, notes, flashcards, quizzes, mind maps, focus timer, AI assistant.
- Full phone navigation drawer covering every study feature and notebook.
- Customizable private profile: display name, avatar, bio, daily study goal, and appearance.
- Native file picker for PDF/DOCX/TXT and avatar photo upload.
- Existing PDF reader with source citations.
- Online-first encrypted cache for recent screens.
- Offline banner and clear retry behavior.
- Account deletion inside the app.
- Crash reporting, privacy policy, terms, support link.
- Play Store internal/closed testing release.

### Mobile navigation and feature coverage

The phone layout uses a full-height navigation drawer, opened from the header menu button and closed by swipe, backdrop tap, or the Android back button. Every study feature is reachable from this drawer; nothing core is hidden behind a secondary menu.

| Drawer item | Mobile v1 behavior |
| --- | --- |
| AI Assistant | Chat, conversation history, running-job badge, quota and connection states; online only. |
| Notes | Notebook-scoped note list and editor; autosave; cached reads; writes require a connection. |
| Flashcards | Deck list, card review, and manual deck/card creation; cached metadata and current review session. |
| Quizzes | Quiz list, manual quiz builder, attempt flow, and results; submission is idempotent and online only. |
| Mind Maps | Map list and editor with pan/zoom and touch-sized controls; writes require a connection. |
| Focus Timer | Foreground timer, pause/resume, and session completion; background timers are deferred. |
| Your Notebooks | Notebook list with color marker, add, rename, and delete; the active notebook is highlighted. |
| Profile row | Avatar, display name, account label, and chevron; pinned to the drawer bottom; opens Profile. |

Sources and the PDF reader open from inside a notebook rather than as separate drawer items. Workspace search, the theme toggle, export, and sign out stay in the header or Profile screen.

Drawer requirements:

- The order above matches the approved phone reference. Notebooks sit below a divider and scroll independently.
- The add-notebook action sits in the “Your Notebooks” section header; the empty state invites creating the first notebook.
- The profile row stays pinned below the scroll area, respects safe-area insets, and remains reachable with long notebook lists.
- The current destination is visibly highlighted and announced to screen readers.
- A compact bottom bar covers the five most-used destinations: Workspace, Notebooks, AI Assistant, Focus Timer, and Profile. The drawer remains the complete feature map.
- Workspace search stays in the phone header and covers notebook and note titles.
- The drawer starts closed on cold launch and remembers its state only for the current session.

### Profile and personalization

Users can customize how their workspace identifies them. The v1 profile is private: there is no public profile page, follower list, or shareable profile URL.

Editable fields:

- **Display name:** required, 2–50 characters, plain text only.
- **Avatar:** system photo picker, square crop, client resize, then upload. JPEG/PNG/WebP up to 5 MB; re-encoded to 512×512; EXIF stripped; malware-scanned before storage. Initials fallback with a deterministic background color when no avatar is set.
- **Short bio/status:** optional, 0–140 characters, plain text, line breaks collapsed.
- **Daily study goal:** 5–240 minutes; used by the workspace summary and Focus Timer.
- **Appearance:** system, light, or dark; stored with the profile and applied before first paint.

Read-only account details:

- Email, sign-in method, account type, and member-since date.
- Email and password changes continue through account settings.

Profile screen requirements:

- Opened from the drawer profile row or the header avatar.
- Avatar preview with replace/remove actions; character counters; save and cancel; unsaved-change guard.
- Optimistic save with rollback and inline errors; success is announced to assistive technology.
- Offline: profile is readable from cache; editing is disabled with a clear “Connect to save changes” message.
- Account actions: password reset, sign out, export workspace, and delete account.
- Delete account requires re-authentication and typed confirmation; it removes the profile, avatar, notebooks, sources, notes, decks, quizzes, maps, sessions, and files.

Profile API and data:

- `GET /api/v1/me/profile` returns the owner-scoped profile.
- `PATCH /api/v1/me/profile` updates display name, bio, daily goal, and appearance.
- `POST /api/v1/me/avatar` and `DELETE /api/v1/me/avatar` handle the image lifecycle.
- UID, email, and provider claims come only from the verified Firebase token, never from the request body.
- Profile record: `displayName`, `bio`, `avatarPath`, `avatarUpdatedAt`, `dailyGoalMinutes`, `theme`, and `updatedAt`.
- Avatars are private, served through short-lived signed URLs, and the previous avatar is deleted after a successful replacement.
- Length limits and image validation are enforced server-side; plain text is sanitized, image type is checked by magic bytes and dimensions, and uploads are rate-limited per user.

Profile privacy:

- Profile data is visible only to its signed-in owner in v1.
- No profile fields appear in analytics, crash reports, or logs beyond an owner identifier.
- Avatar changes, profile edits, and account deletion are audited.

### Deferred

- Full offline write sync and conflict resolution.
- Offline AI, OCR, or new file processing.
- Push notifications for background jobs.
- iOS store release and Sign in with Apple.
- Widgets, background timers, and advanced native integrations.
- Public deck marketplace, social features, or multiplayer study.
- Public or social profiles, profile sharing, follower counts, cover images, and animated avatars.
- Camera capture for avatars; v1 uses the system photo library picker only.

## 5. Security requirements

Target: OWASP MASVS-L1 with L2 controls where practical. A successful release requires all release blockers below.

### 5.1 Accounts and tokens

- [ ] Firebase Auth with email/password and Google on Android.
- [ ] Email verification required before workspace access.
- [ ] MFA available for email/password accounts.
- [ ] Native Firebase Auth plugin; tokens stored by the native SDK in Keychain/Keystore, never in `localStorage`.
- [ ] Backend verifies ID tokens, expiry, audience, issuer, and revocation.
- [ ] Session expired handling returns the user to sign-in without leaking data.
- [ ] Profile edits and avatar changes require a verified token and are owner-scoped.
- [ ] Avatar uploads are size/type/dimension limited and rate-limited per user.
- [ ] In-app account deletion removes Auth, profile, avatar, Firestore, and Storage data.
- [ ] Local demo endpoints and demo credentials are absent/disabled in production.

### 5.2 App integrity

- [ ] Firebase App Check with Play Integrity in production.
- [ ] Debug App Check provider used only in development.
- [ ] Backend rejects requests without a valid App Check token once enforcement is enabled.
- [ ] App Check rollout starts in monitor mode, then enforce after metrics look healthy.
- [ ] Release build has debugging disabled and no test-only backdoors.

### 5.3 API and authorization

- [ ] Every endpoint derives the owner from the verified token, never from a client-supplied user ID.
- [ ] Every notebook, source, note, deck, card, quiz, attempt, map, session, file, profile, and avatar is owner-scoped.
- [ ] Profile endpoints reject client-supplied UID, email, and provider claims.
- [ ] Automated authorization matrix tests cover cross-user reads, writes, deletes, downloads, profile edits, avatar access, and job polling.
- [ ] Rate limits use Redis or Firestore transactions, not per-process memory.
- [ ] Upload size, page count, JSON depth, and request body limits enforced.
- [ ] Idempotency keys for uploads, generation requests, and quiz submissions.
- [ ] Errors returned to clients contain no stack traces, SQL, provider responses, or secrets.
- [ ] HTTPS only, HSTS, secure headers, and an explicit CORS allowlist.
- [ ] CORS allows the web origin and Capacitor origins (`https://localhost`, `capacitor://localhost`) without wildcards.

### 5.4 Data at rest

- [ ] Firestore and Storage rules deny direct client access.
- [ ] Backend service account has least-privilege IAM.
- [ ] Firestore point-in-time recovery and scheduled backups enabled.
- [ ] Backup restore tested before launch.
- [ ] Storage lifecycle rules remove deleted/orphaned originals and replaced avatars.
- [ ] Avatars are private, re-encoded with EXIF removed, and accessible only through short-lived owner-checked URLs.
- [ ] Account deletion removes profile fields, avatars, originals, extracted text, jobs, and generated artifacts.

### 5.5 Files and document processing

- [ ] Private Storage bucket; no public objects.
- [ ] Short-lived signed download URLs (for example, five minutes) issued only after ownership checks.
- [ ] MIME sniffing and file-signature validation, not extension checks alone.
- [ ] Avatar uploads are validated by magic bytes, dimensions, and pixel count, then re-encoded before storage.
- [ ] Malware scanning and quarantine before extraction; EICAR test file must be blocked.
- [ ] PDF JavaScript disabled in the viewer; PDF.js kept current.
- [ ] Upload and OCR work run in a sandboxed worker with CPU/memory/time limits.
- [ ] No plaintext source binaries in the mobile cache for online-first v1.
- [ ] Original file names sanitized in logs and error messages.

### 5.6 AI

- [ ] Provider keys live only in Secret Manager/environment secrets.
- [ ] Per-user daily quotas and per-request token/output limits enforced server-side.
- [ ] Provider allowlist and explicit user approval remain in place.
- [ ] Document text is treated as untrusted data; instructions inside files are never executed.
- [ ] Citations and structured JSON are validated before storage.
- [ ] AI output cannot trigger file deletion, account changes, or other privileged actions.
- [ ] Logs redact document text, prompts, tokens, and personal data.
- [ ] An AI kill switch can disable generation without taking down study features.

### 5.7 Mobile device

- [ ] Android scheme is HTTPS; cleartext traffic disabled.
- [ ] Capacitor navigation allowlist restricts external URLs.
- [ ] Android backup disabled or explicitly encrypted.
- [ ] No unnecessary permissions; file access uses the system picker.
- [ ] Release build minified/obfuscated with R8 and signed with Play App Signing.
- [ ] No exported activities, services, or receivers without a justified need.
- [ ] Screenshot protection for sensitive document screens evaluated before release.
- [ ] Root/jailbreak detection optional; do not use it as the only security control.

### 5.8 Cache

- [ ] Cache uses AES-GCM encryption via Web Crypto.
- [ ] Cache key generated per install and stored in Android Keystore through a secure-storage plugin.
- [ ] Cache is scoped by Firebase user ID and cleared on logout/account switch.
- [ ] Cached profile and avatar are owner-scoped, size-bounded, and refreshed after a profile edit.
- [ ] Cache TTL and maximum size are enforced.
- [ ] Cached source binaries are disabled in v1.
- [ ] Offline mode is read-only; writes show a clear "connect to save" message.
- [ ] Profile edits are rejected offline while the cached profile remains readable.

### 5.9 Supply chain and releases

- [ ] Lockfiles committed and used in CI (`npm ci`, pinned Python requirements).
- [ ] `npm audit`, `pip-audit`, Dependabot, secret scanning, and Semgrep/SAST run in CI.
- [ ] No `.env`, service-account JSON, keystore, or AI key committed.
- [ ] Signed AAB produced by CI; build artifacts retained and hashed.
- [ ] SBOM generated per release.
- [ ] Staged rollout with rollback plan and remote kill switches for AI and uploads.

### 5.10 Monitoring and response

- [ ] Crash reporting without personal data.
- [ ] API latency, error rate, auth failures, App Check failures, AI quota, and storage alerts.
- [ ] Audit log for profile/avatar changes, account deletion, file deletion, and admin actions.
- [ ] Incident response contact and runbook.
- [ ] Security fixes can be shipped without a full feature release.

## 6. Android UX work

- Full navigation drawer ordered as AI Assistant, Notes, Flashcards, Quizzes, Mind Maps, Focus Timer, Your Notebooks, and Profile.
- Compact bottom bar for Workspace, Notebooks, AI Assistant, Focus Timer, and Profile; the drawer is the complete feature map.
- Profile row pinned to the drawer bottom with avatar, display name, and account label.
- Safe-area insets, status bar color, splash screen, and adaptive icons.
- Android back button behavior: close drawer or modal, go back, or exit predictably.
- Touch targets of at least 48dp and no hover-only interactions.
- Native file picker for PDF/DOCX/TXT and the system photo picker for avatars; upload progress and retry.
- Keyboard avoidance for notes, quiz creation, login, and profile forms.
- PDF pinch/zoom and loading states on low-end devices.
- Offline banner with last-sync time and retry action.
- Clear "AI requires a connection" state.
- Session-expired and revoked-token flows.
- Profile customization screen with avatar crop/preview, validation, save/cancel, dirty-state guard, and offline-disabled editing.
- Appearance selector (system/light/dark) applied before first paint.
- Play Store account-deletion and privacy links.

## 7. Delivery plan

### Phase 0 - Decisions and foundation (week 1)

- Finalize package name, app name, signing ownership, and store accounts.
- Create dev/staging/prod Firebase projects.
- Enable Auth, Firestore, Storage, App Check, and budgets/alerts.
- Write the threat model and release-blocker checklist.
- Add `VITE_API_BASE_URL` and environment separation.
- Confirm Capacitor version and Android target SDK.

Gate: staging Firebase project exists; no production secrets in the repo; API URL configuration documented.

### Phase 1 - Production backend hardening (weeks 1-3)

- Deploy FastAPI to staging with Firebase Admin and App Check.
- Move rate limits, locks, and AI counters to Redis/Firestore transactions.
- Add account deletion, audit logging, and secure headers.
- Add profile GET/PATCH endpoints and owner-scoped profile storage.
- Add avatar upload/delete with image validation, re-encoding, private Storage, and signed URLs.
- Add malware scanning/quarantine to uploads.
- Configure private Storage, signed downloads, backups, and lifecycle rules.
- Add CORS entries for Capacitor origins.
- Load-test uploads, auth, profile edits, and AI quota paths.
- Verify production build has no local/demo auth path.

Gate: staging API rejects missing/invalid token and App Check; cross-user access tests pass; profile/avatar access is owner-only; EICAR upload blocked.

### Phase 2 - Capacitor Android shell (weeks 3-5)

- Add Capacitor config and Android project.
- Set `webDir` to the existing production build output.
- Add native Firebase Auth and Google sign-in.
- Add secure storage, file picker, photo picker, share, status bar, splash, and back-button plugins.
- Configure HTTPS scheme, navigation allowlist, and release hardening.
- Add native-aware API base URL and token attachment.
- Build a signed internal AAB and install it on a physical Android device.

Gate: login, notebook load, upload, PDF open, avatar selection, and logout work on a real device with no debug server.

### Phase 3 - Online-first cache and mobile UX (weeks 5-7)

- Add encrypted read cache with TTL and logout wipe, including profile/avatar cache.
- Add offline banner and retry states.
- Add the full navigation drawer, compact bottom bar, notebook list, and pinned profile row.
- Add profile customization with avatar picker/crop, display name, bio, daily goal, and appearance.
- Add upload progress, cancel, and retry.
- Add PDF loading/performance improvements.
- Add crash reporting and basic analytics events without PII.

Gate: cached screens open offline; drawer exposes every feature; profile edits and avatar upload persist; offline edits fail safely; cache cannot be read after logout; no plaintext source files cached.

### Phase 4 - Security verification (weeks 7-8)

- Run MASVS/MASTG-oriented review.
- Run MobSF or equivalent static APK/AAB scan.
- Run authorization matrix and IDOR tests, including profile and avatar access.
- Run upload fuzzing, avatar-image fuzzing, rate-limit, token-replay, and App Check bypass tests in debug builds.
- Run dependency and secret scans.
- Fix all critical/high findings.
- External penetration test before public launch.

Gate: zero critical/high findings open; medium findings have owners and dates.

### Phase 5 - Play Store readiness (weeks 8-10)

- Play Console setup, app signing, package verification.
- Privacy policy, terms, support, and account-deletion URLs.
- Data safety form covering profile fields and avatar storage, plus AI-content disclosure.
- Screenshots showing the drawer and profile customization, feature graphic, description, and content rating.
- Internal testing track, then closed testing with 12+ testers for the required period.
- Pre-launch report review and device compatibility fixes.

Gate: pre-launch report has no critical issues; store listing and policy pages approved.

### Phase 6 - Launch and stabilization (weeks 10-12)

- Staged rollout (5% -> 20% -> 50% -> 100%).
- Monitor crashes, auth failures, uploads, and AI errors.
- Hotfix process and rollback plan.
- Collect feedback and prioritize the iOS port.

Gate: crash-free sessions and API error rate meet agreed thresholds for one week.

## 8. Android release blockers

- [ ] No demo/local auth path in production.
- [ ] App Check enforced.
- [ ] Tokens stored natively, not in browser storage.
- [ ] All API authorization tests pass.
- [ ] File malware scan and quarantine active.
- [ ] PDF JavaScript disabled.
- [ ] Cache encrypted and wiped on logout.
- [ ] Profile edits and avatar uploads are owner-scoped and validated server-side.
- [ ] Avatar storage is private, old avatars are deleted, and account deletion removes profile/avatar data.
- [ ] Account deletion works end to end.
- [ ] Cleartext traffic blocked.
- [ ] No secrets found in the release artifact.
- [ ] Critical/high penetration-test findings fixed.
- [ ] Privacy policy, terms, support, and deletion URLs live.
- [ ] Play data safety and AI disclosures completed.
- [ ] Rollback and AI kill switch tested.

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Google Play rejects a thin website wrapper | Launch delay | Native auth, file picker, offline cache, share, notifications, biometrics |
| iOS work needs macOS | Schedule delay | Android first; plan macOS CI before iOS |
| Online-first cache disappoints offline users | Product risk | Clear offline states; full sync in v2 |
| AI/OCR abuse or cost spike | Financial risk | App Check, quotas, Redis rate limits, kill switch |
| In-process limits fail across instances | Security/scale risk | Move locks and quotas to Redis/Firestore |
| PDF processing on low-end devices | Poor UX | Device testing, page limits, worker timeouts, lazy rendering |
| Avatar upload abuse or storage cost spike | Cost/security risk | 5 MB cap, re-encoding, per-user rate limits, lifecycle cleanup |
| Profile customization scope creep | Schedule risk | Fixed v1 fields; public/social profiles explicitly deferred |
| Firebase lock-in | Strategic risk | Keep data export and API abstraction; revisit only if needed |

## 10. First actions

1. Approve this plan, the drawer order, and the profile fields.
2. Choose the Android package name.
3. Create Firebase dev/staging/prod projects and Play Console account.
4. Add `VITE_API_BASE_URL` and environment configuration.
5. Harden and deploy the staging API, including profile and avatar endpoints.
6. Add the Capacitor Android shell and native Firebase Auth.
7. Build the drawer and profile customization screen.
8. Produce the first signed internal AAB.
