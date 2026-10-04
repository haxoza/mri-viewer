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
npm run check           # Lint, formatting, unit tests, type checking, build, privacy guard
npx playwright install chromium
npm run test:e2e        # Production-bundle browser tests with synthetic DICOM
VIEWER_DEV=1 npm run test:e2e # Same workflows against the development server
npm run lint           # Oxlint for application code, tests, scripts, and configuration
npm run lint:fix       # Apply safe lint fixes
npm run format         # Apply Oxfmt to code and configuration
npm run format:check   # Check formatting without writing files
npm run build
npm run preview
```

Oxlint and Oxfmt use the checked-in `.oxlintrc.json` and `.oxfmtrc.json` settings.
CI runs both through `npm run check`. CLI scripts may print status and errors;
application code retains the `no-console` rule. Formatting skips reference docs
and public assets, as well as ignored build outputs and local data.

## Viewing

- Select a series in the right sidebar to assign it to the active pane. Mixed orientations and time/echo/diffusion dimensions appear as separate stacks.
- Use wheel, slider, exact slice number, or one-finger dragging in **Slices** mode. With the image focused: Up/Down, Page Up/Page Down, Home/End, and Space. Navigation stops at stack boundaries.
- Choose **Pan**, **Zoom**, or **Window** for dragging; pinch zoom and two-finger pan are available on touch devices. Fit/reset preserve position.
- Compare up to four panes, resize the main split, and enable **Link** on compatible panes to follow patient-space positions. Windows and zoom remain independent.
- **MPR** opens axial, sagittal, and coronal reconstructions sharing one admitted volume. The plane closest to the acquisition orientation opens in the large, active pane; the other two open as smaller previews. For oblique acquisitions this is the closest anatomical plane, not an exact native slice. The viewport mode selector also assigns individual reconstructed planes. **Crosshair** moves the other planes to the selected point.
- Cine supports speed, reverse, loop, bounce, and time playback at a fixed spatial position. Manual navigation pauses playback. Supplied frame timing is used at the default speed; changing speed scales it.
- **Metadata** inspects a chosen source instance/frame, including nested sequences and private tags. The series summary identifies common versus varying fields.
- **Ellipse** draws red/yellow/cyan screen marks, with undo and clear. Marks stay fixed during navigation; they do not track anatomy.
- **Export** opens a frozen preview of a pane or workspace. Refresh after changing output settings; PNG/JPEG downloads use the displayed capture. Identifiers burned into source pixels remain in exports.
- **Screenshot view** beside Export hides controls for the active pane or whole workspace. It works without agent tools; use **Restore controls** or Escape to exit.
- **Agent tools** optionally exposes the live viewer through WebMCP. Agent captures maximize a live pane/workspace for a browser screenshot; **Restore controls** or Escape returns to normal viewing. See [agent tools, privacy boundary and desktop verification](docs/webmcp.md).

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

The public viewer is hosted at https://mri-viewer.haxoza.com using Cloudflare Workers Static Assets. See [deployment commands and authentication](docs/hosting.md#cloudflare-deployment).

Deploy only `dist/` over HTTPS. Codecs, workers, and scripts are bundled at the same origin. See [hosting configuration](docs/hosting.md) for headers. Once the required application/codec assets have loaded, local viewing works with the network disabled. Offline reopening is not implemented; no service worker caches examination data.

### Linked native series experiment

Choose a comparison layout, open a separately acquired stack in each pane, enable **Native links**, and turn **Link** on for each participating pane. Select **Crosshair** and click inside an acquired image. Other compatible linked stack panes select the nearest acquired plane to that patient-space point. Each stack keeps its source pixel matrix and independent pan, zoom and window; no volume resampling, registration, fusion or synthetic image generation occurs.

Scrolling, slice buttons, keyboard navigation and cine move the shared point along the source slice normal onto its selected acquired plane, preserving its in-plane position. Targets choose slices by physical distance, not slice number. Unlink a pane for independent navigation. Disabling Native links restores the existing parallel-stack link behavior. MPR remains a separate feature with its own shared crosshair, including in mixed layouts.

The small cyan cross projects the shared point onto the displayed plane; the reported absolute offset is the distance in millimeters to that plane. A dashed cross indicates an approximation or uncovered location. Dashed gold lines, labeled by pane number, show intersections of the **displayed acquired planes**, clipped to both image footprints. Parallel planes have no intersection line; the pane reports their separation. Coincident planes are labeled “same plane (within 0.01 mm)”. Their reference lines in a third pane may overlap, so each reference has a separate colored pane label. Out-of-coverage points retain the nearest acquired slice with an explicit warning; an off-image point has no cross. Coverage is conservatively bounded by the first/last acquired plane centers and the selected image rectangle; gaps and finite slice thickness are not treated as proof of sampled anatomy. Missing/invalid geometry, repeated positions, different studies, and different/missing Frame of Reference UIDs prevent linking. Existing images remain manually navigable.

**Interpretation limits:** this is an experimental navigation aid, not a diagnostic or registration tool. A shared Frame of Reference UID identifies a coordinate system; it does not independently verify that anatomy stayed aligned between acquisitions. Patient motion or deformation can invalidate apparent correspondence. Pixel spacing, nominal slice thickness and acquired plane spacing describe different properties; fine in-plane pixels do not provide equivalent through-plane detail. Inspect each original acquisition and its context; a projected cross or intersection is not a verified anatomical landmark.

Geometry follows [DICOM PS3.3 Image Plane Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html) and the [Frame of Reference Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.4.html). The latter requires the imaging target's position to stay constant relative to the reference; the motion limitation above is the practical consequence of that assumption. [DICOM Spatial Registration Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.20.2.html) separately describes registration transforms and cautions that common-reference calculations depend on consistent patient positioning. This experiment applies none of those transforms.

Native point/intersection overlays and interpretation labels are included when export overlays are enabled. Export without overlays contains acquired pixels without these navigation annotations.

Synthetic verification: `npm test` and `npm run test:e2e`. Private verification is opt-in: `VIEWER_URL=http://127.0.0.1:4173 node scripts/verify-private-native.mjs /absolute/local/dicom/path`. The script checks the initial pair in memory, exercises local native interactions, blocks external requests, and emits only aggregate verification results. It records no screenshots, traces, filenames, identifiers or metadata dumps. Do not add medical files to the repository.

WebMCP can configure native linking without toolbar interaction: call `set_layout`, `assign_view` with `mode: "acquired"`, `set_native_links({"enabled": true})`, and `set_linked` for each pane. Then use `set_crosshair` with normalized pane coordinates and `set_slice` for physical navigation. Repeating `set_native_links` with the current value preserves the selected point. `get_viewer_state` reports `nativeLinks`, catalog `nativeLinkable`, and per-pane `nativeLink` status, nearest slice, displayed-plane offset in mm, coverage and reference relationships (`intersecting`, `coincident`, `parallel`, `outside-image`, or `incompatible`). These diagnostics expose neither identifiers nor patient-space coordinates. Set `enabled: false` to restore parallel-stack linking. The private verifier's optional `--three` flag also checks the third coronal series and coincident-reference annotations.
