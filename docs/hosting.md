# Static hosting

## Cloudflare deployment

Production: https://mri-viewer.haxoza.com

`wrangler.jsonc` pins the Haxoza account, the `mri-viewer` Worker name, and that single custom hostname. Cloudflare Workers Static Assets serves `dist/`; there is no application Worker script, API, database, or storage binding. The `workers.dev` address and preview URLs are disabled.

Use Node.js 24+ and the Wrangler version pinned in the lockfile. Authenticate once from an interactive terminal:

```sh
npm ci
npx wrangler login --scopes account:read user:read workers_scripts:write workers_routes:write zone:read
```

Wrangler saves the renewable OAuth login outside the repository. Release from an interactive terminal after the browser checks pass:

```sh
npm run test:e2e
npm run deploy
VIEWER_URL=https://mri-viewer.haxoza.com npm run test:e2e
```

`npm run deploy` runs lint, unit tests, the production build, and the privacy guard before uploading. Browser checks use generated synthetic examinations and keep traces and screenshots disabled. `VIEWER_URL` runs them against an existing deployment without starting a local server.

Before the first deployment, check that the Worker name and custom hostname are unused. Never accept a prompt to replace an existing DNS record or move a hostname from another Worker. `npm run deploy` refuses to run without an interactive terminal: Wrangler can automatically replace conflicting custom-domain records in non-interactive mode. Do not bypass this guard for unattended deployment until it has explicit conflict checks.

The current release workflow uses local Wrangler authentication. GitHub Actions continues to run verification; unattended deployment needs its own narrowly scoped Cloudflare API token stored as a GitHub secret. Do not copy the local OAuth credentials into CI or the frontend bundle.

To inspect Cloudflare's static-serving behavior locally:

```sh
npm run build
npm run preview:cloudflare
```

In another terminal, `VIEWER_URL=http://127.0.0.1:4173 npm run test:e2e` tests that server. `npx wrangler deploy --dry-run` validates the deployment configuration without publishing.

## Hosting requirements

Build with `npm ci && npm run build` and deploy only `dist/`. Never serve the repository root, `local-data/`, `exports/`, test output, or `.git` in production. Vite development explicitly denies private paths; the production output contains application assets only.

Use HTTPS, JavaScript MIME types for workers, `application/wasm` for WASM files, and these response headers (already configured for `npm run preview`):

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

For hosts supporting a `_headers` file, the included `public/_headers` is copied into `dist/`. Other hosts must configure equivalent headers. No cross-origin runtime assets, external fonts, upload endpoints, or analytics are used. The verified codec paths do not require SharedArrayBuffer or cross-origin isolation.

The application is deployed at the origin root by default. If deploying under a subdirectory, configure Vite's `base`, rebuild, and re-run worker/codec/export checks against that path.

Offline continuation means continuing a session after its required application, worker, and codec assets have loaded. Newly needed codec assets may still need loading. Offline reopening is not supplied: there is no app-shell service worker, persistent examination cache, or durable file permission store.
