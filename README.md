# Local MRI Viewer

A React + TypeScript viewer for locally selected MRI examinations. Files, ZIP extraction, decoding, reconstruction, and exports stay in the browser. There is no application backend or upload endpoint.

## Run

Requires Node.js 24+.

```sh
npm ci
npm run dev
```

Open the localhost URL, then choose **Open folder**, **Open files**, or **Open ZIP**. Extensionless DICOM files are supported. Examinations are session-only; reopen them after reloading.

```sh
npm run check           # Oxlint, unit tests, type checking, build, privacy guard
npx playwright install chromium
npm run test:e2e        # Production-bundle browser tests with synthetic DICOM
VIEWER_DEV=1 npm run test:e2e # Same workflows against the development server
npm run format         # Oxfmt
npm run build
npm run preview
```

## Viewing

- Select a series in the right sidebar to assign it to the active pane. Mixed orientations and time/echo/diffusion dimensions appear as separate stacks.
- Use wheel, slider, exact slice number, or one-finger dragging in **Slices** mode. With the image focused: Up/Down, Page Up/Page Down, Home/End, and Space. Navigation stops at stack boundaries.
- Choose **Pan**, **Zoom**, or **Window** for dragging; pinch zoom and two-finger pan are available on touch devices. Fit/reset preserve position.
- Compare up to four panes, resize the main split, and enable **Link** on compatible panes to follow patient-space positions. Windows and zoom remain independent.
- **MPR** opens axial, sagittal, and coronal reconstructions sharing one admitted volume. The viewport mode selector also assigns individual reconstructed planes. **Crosshair** moves the other planes to the selected point.
- Cine supports speed, reverse, loop, bounce, and time playback at a fixed spatial position. Manual navigation pauses playback. Supplied frame timing is used at the default speed; changing speed scales it.
- **Metadata** inspects a chosen source instance/frame, including nested sequences and private tags. The series summary identifies common versus varying fields.
- **Export** renders an active pane or the imaging workspace to PNG/JPEG at the requested size. Position/crosshair overlays are opt-in. Identifiers burned into the source pixels remain in exports.

## Limits and verification

See [implementation and validation status](docs/implementation-status.md) for the compatibility matrix, memory limits, measured sample results, and remaining release checks. Chromium automation covers the implemented workflows; real tablet, Safari/Firefox, minimum-hardware, and larger-study acceptance remain to be measured.

The initial MR compatibility boundary, product requirements, and longer-term extensions are in [the implementation plan](docs/plans/implementation-plan.md).

## Private local sample

Keep real examinations, reports, archives, screenshots, and metadata dumps under ignored `local-data/` or `exports/`. Never force-add them. The Vite development server denies private paths, including absolute and encoded variants. CI uses only generated synthetic fixtures and does not upload test artifacts.

With the production preview running, this optional check decodes every selected sample image and prepares one three-plane reconstruction:

```sh
node scripts/verify-private-sample.mjs local-data/dicom
node scripts/verify-private-sample.mjs local-data/dicom --zip
```

Set `VIEWER_URL` if using another local port. The ZIP check creates a temporary archive under `local-data/verification/` and removes it afterward. These checks emit aggregate counts and timing only; they do not save screenshots, traces, or raw metadata. They are excluded from CI.

## Hosting

Deploy only `dist/` over HTTPS. Codecs, workers, and scripts are bundled at the same origin. See [hosting configuration](docs/hosting.md) for headers. Once the required application/codec assets have loaded, local viewing works with the network disabled. Offline reopening is not implemented; no service worker caches examination data.
