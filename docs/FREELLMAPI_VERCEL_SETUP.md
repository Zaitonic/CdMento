# FreeLLMAPI with CdMento on Vercel

CdMento calls FreeLLMAPI from its FastAPI backend. The FreeLLMAPI URL and unified
API key stay on the server; never add them to a `VITE_` variable. Vercel cannot
reach `localhost` on your computer. Use a stable public HTTPS URL for ongoing
production traffic.

> FreeLLMAPI's upstream documentation describes its proxy as single-user and
> guarded by the unified API key. Do not expose its dashboard publicly. Add
> persistent storage for its SQLite data and encryption key, and review the
> upstream provider terms before sending CdMento user prompts through it.

## Deploy the proxy

Use the upstream Docker Compose deployment as the source. It includes the API
and dashboard and persists its database in a named Docker volume. Keep that
volume and the `ENCRYPTION_KEY` stable across deploys; configure the platform to
preserve persistent storage at `/app/data` (confirm the mount path against the
upstream Compose file for the version you deploy).

### Render

1. Create a **Web Service** from `https://github.com/tashfeenahmed/freellmapi`.
2. Choose the **Docker** runtime; Render builds the repository root `Dockerfile`
   (the app itself runs as a single container; Compose's optional Watchtower is
   not needed).
3. Add a persistent disk mounted at `/app/server/data`. Add the upstream-required
   `ENCRYPTION_KEY` as a service secret. Keep the service listening on `PORT`
   and `0.0.0.0`. Do not put upstream provider keys in a Dockerfile.
4. Deploy, configure upstream provider keys in the proxy dashboard, create a
   unified API key, and copy the HTTPS `onrender.com` service URL.

Render supports Dockerfile builds and persistent disks for web services. Free
instances can sleep, so use an always-on plan if cold-start delays are not
acceptable. See [Render Docker deployments](https://render.com/docs/docker),
[web services and port binding](https://render.com/docs/web-services), and
[persistent disks](https://render.com/docs/disks).

### Railway

1. Create a project from the upstream GitHub repository; Railway detects its
   root `Dockerfile`. For a non-root Dockerfile, set `RAILWAY_DOCKERFILE_PATH`.
2. Add a persistent volume mounted at `/app/server/data`. Set `ENCRYPTION_KEY`
   as a Railway secret variable. Let the service use Railway's `PORT` and
   listen on `0.0.0.0`.
3. Deploy, configure upstream provider keys, create the unified API key, then
   generate a public domain with HTTPS in the service's Networking settings.

See [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) and
[Railway volumes](https://docs.railway.com/reference/volumes).

### Fly.io

From a clone of the upstream repository, run these commands in PowerShell after
installing and authenticating `flyctl`:

```powershell
git clone https://github.com/tashfeenahmed/freellmapi.git
Set-Location freellmapi
fly launch --no-deploy
$region = "sin" # Choose a Fly region near your Vercel deployment.
fly volumes create freellmapi_data --region $region --size 1
$bytes = New-Object Byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$encryptionKey = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
fly secrets set "ENCRYPTION_KEY=$encryptionKey"
```

Edit generated `fly.toml`: set `internal_port = 3001` under `[[services]]` and
add this volume mount:

```toml
[[mounts]]
source = "freellmapi_data"
destination = "/app/server/data"
```

Then deploy and initialize the proxy:

```powershell
fly deploy
fly status
```

Configure provider keys and create the unified API key in the proxy dashboard.
Fly assigns an HTTPS `https://<app-name>.fly.dev` URL. See [Fly Docker deploys](https://fly.io/docs/launch/)
and [Fly volumes](https://fly.io/docs/volumes/).

> The Fly commands above create infrastructure and may incur charges. Check
> current platform pricing before provisioning. Replace the placeholder region
> and generate the encryption secret in a secure password manager or secret
> generator; do not commit it.

## Configure CdMento in Vercel

In **Vercel → CdMento project → Settings → Environment Variables**, add these
server-side values to **Production** (and Preview if needed):

```dotenv
FREELLMAPI_ENABLED=true
FREELLMAPI_API_KEY=<unified-key-from-the-FreeLLMAPI-dashboard>
FREELLMAPI_BASE_URL=https://<public-proxy-host>/v1
FREELLMAPI_MODEL=<exact-id-returned-by-the-proxy-model-catalog>
FREELLMAPI_FREE_TIER_CONFIRMED=true
AI_ENABLED=true
AI_FREE_TIER_CONFIRMED=true
AI_PROVIDER_ORDER=cloudflare,freellmapi,groq,openrouter
```

Use the actual model ID from the proxy catalog; do not assume that
`ministral-8b-latest` is available. The URL may end with `/`—CdMento strips
trailing slashes before appending `/models` or `/chat/completions`. Vercel
localhost URLs are immediately marked `misconfigured` and skipped.

After saving environment variables, redeploy the Vercel project so the
production function receives them.

## Verify

Check the proxy model catalog first:

```powershell
curl.exe -H "Authorization: Bearer <unified-key>" "https://<public-proxy-host>/v1/models"
```

Then sign in to CdMento and open Swagger at
`https://cdmento-study-7.vercel.app/docs`. Run authenticated
`GET /api/v1/ai/status`. The response includes a key-free `freellmapi` object,
`fallback_order`, configured model, state (`active`, `disabled`,
`misconfigured`, or `unreachable`), and most recent latency when available. A
successful `active` status means it is configured; an actual AI request is what
checks connectivity. A failed request marks it unreachable and routes to the
next available provider.

For a direct production check from PowerShell, provide a valid CdMento Firebase
Bearer token:

```powershell
$headers = @{ Authorization = "Bearer <CdMento-Firebase-ID-token>" }
Invoke-RestMethod -Headers $headers -Uri "https://cdmento-study-7.vercel.app/api/v1/ai/status"
```

## Temporary demo tunnel (not production)

This shares your local proxy with the internet while the tunnel process runs.
Use it only for a short demo, and stop it with `Ctrl+C` when finished. Do not
publish the FreeLLMAPI dashboard or reuse this temporary URL in production.

```powershell
# Install cloudflared once:
winget install --id Cloudflare.cloudflared -e
# Terminal 1: start FreeLLMAPI locally and ensure localhost:3001/v1/models works.
# Terminal 2:
cloudflared tunnel --url http://127.0.0.1:3001
```

Copy the generated `https://<random-name>.trycloudflare.com` URL and set
`FREELLMAPI_BASE_URL=https://<random-name>.trycloudflare.com/v1`. Quick tunnels
are temporary and are not a stable production endpoint.
