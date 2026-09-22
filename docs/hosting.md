# Static hosting

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
