# Implementation and validation status

Updated 2026-09-22. The application implements the first-version workflows in the plan. This is a working implementation with Chromium verification, not a claim that every release acceptance criterion or target device has passed.

## Implemented

| Area | Implementation |
| --- | --- |
| Local import | Folder/file selection, recursive drop, worker indexing, growable header reads, progressive catalog, cancellation with partial results, duplicate hashing and conflicting-UID reporting, study removal |
| ZIP | Blob-backed random-access ZIP reader, stored/DEFLATE entries, sequential bounded extraction in the I/O worker, size/count/path/CRC checks, cancellation cleanup, source re-reading without persistent extraction |
| Catalog | DICOM study/series identities, orientation/matrix/image-type/frame-of-reference and time/echo/diffusion partitioning, patient-space order, instance-order fallback with a warning, DICOMDIR reference checking against supplied files |
| Rendering | Pinned Cornerstone 5.10.8 core, metadata, and DICOM loader; compact metadata provider; full Part 10 buffers released after decoding; bounded decode concurrency and decoded cache |
| Navigation | Middle-slice initialization, per-pane restore, latest-target coalescing, requested/displayed distinction, render-completion settlement, retry, directional prefetch, focus-scoped keyboard, wheel/trackpad, slider/index/buttons, touch/pinch/pan |
| Comparison | All planned 1–4-pane arrangements, primary splitter, retained hidden-pane state, optional physical-position linking with coverage checks; four rows/columns adapt to a grid on narrow screens |
| Cine | Spatial or temporal playback, rate/timing, reverse, loop, bounce, a leader clock and pending-frame backpressure, pause on manual interaction, removal, hidden document, or export |
| MPR | Geometry/scalar admission, native integer volume storage where possible, conservative allocation estimates, shared volume references, per-pane axial/sagittal/coronal assignment, reconstructed ranges/step sizes, patient-space crosshair |
| Metadata | On-demand worker parsing, dictionary labels, character-set decoding, private/unknown tag identifiers, nested sequences, virtualized rows, source-instance/frame choice, common/varying summary |
| Export | Sequential temporary renderer, stable frame snapshot, exact output dimensions and MIME verification, PNG/JPEG quality, aspect lock/letterboxing, active/workspace scope, optional nonidentifying overlays |
| Quality | Oxlint on TypeScript/TSX, Oxfmt, Vitest behavior tests, Playwright development and production flows, CI, tracked/build medical-data guard, development private-path denial |

Optional thumbnails and series drag-to-pane were not necessary for the click/tap assignment workflow and are not implemented. Only the primary divider is resizable; individual secondary cells are equal-sized. There is one opt-in linked stack group per workspace. Reconstructed planes of the same volume share a crosshair automatically.

## Verified locally

Environment: macOS ARM64, 36 GiB system RAM, 11 logical CPU cores; headless Chromium 153.0.8010.12, Playwright 1.63.0, SwiftShader rendering. These measurements are not minimum-hardware or real-GPU benchmarks.

| Check | Result |
| --- | --- |
| Private sample via selected files | 433/433 frames decoded; 1 study, 8 series, 10 orientation-compatible display sets |
| Private sample via stored ZIP | Same 433/433 decoded frames and 1/8/10 catalog counts |
| Sample MPR | Three reconstructed panes initialized for a valid series, for both file and ZIP sources |
| Import to first usable frame | About 1.54 s for files and 1.93 s for ZIP in these local runs; one observation each, not p95 |
| Network/runtime checks | Zero external requests and zero uncaught browser errors in the sample runs |
| Synthetic unit suite | 12 passing tests: catalog/geometry, physical linking, navigation/cine, DICOM/Enhanced MR normalization, ZIP extraction |
| Synthetic browser suite | 6 tests passing in both development and production: import, exact navigation/boundaries, four-pane layout, MPR, exported PNG dimensions, metadata/focus, ZIP round-trip pixel equivalence, deduplication, offline navigation, linked restoration, time selection, touch transitions, manual cine pause |
| Development codec smoke test | One private JPEG 2000 instance decoded with zero uncaught browser errors |
| Privacy boundary | Direct, encoded, absolute private paths and `.git` requests return 403 in development; build/tracked-file guard passes |
| Dependencies | Exact versions and lockfile; `npm audit` reports zero known vulnerabilities at implementation time |

Regression tests were added for bugs found in Enhanced MR AT dimension pointers, duplicate-position linking, frame settlement before rendering, discrete wheel accumulation, and shared-crosshair volume bounds. Browser tests drove MPR/export and subsequent workflow verification. Fixtures are generated from source code; no medical binaries or private snapshots are committed.

## DICOM compatibility

Part 10 headers, study/series/SOP identities, single-channel MONOCHROME1/2, and 8/16-bit integer pixels are required. Non-image objects, mosaics, spectroscopy, SEG/SR, presentation states, PDFs, float pixel elements, and deflated datasets are explicitly outside this adapter. DICOMDIR is an index; its image files must also be selected.

| Object / encoding | Evidence |
| --- | --- |
| Classic MR, explicit little-endian | Synthetic indexing/rendering/browser fixtures |
| Classic MR, JPEG 2000 lossless | All 433 supplied sample instances decoded locally |
| Enhanced MR, explicit little-endian | Generated shared/per-frame/dimension fixture; spatial and temporal UI verified |
| Signed data, rescale, MONOCHROME1 | Indexing fixtures and loader integration; broader pixel-reference validation remains |
| Implicit little-endian, explicit big-endian | Decoder paths enabled; additional rendering fixtures needed before claiming verified support |
| JPEG lossless, JPEG-LS, RLE, JPEG 2000 lossy | Codec paths enabled, but not advertised as verified without codec fixtures |
| Enhanced MR vendor-specific dimensions | Dimension-index handling and standard functional groups implemented; real vendor coverage remains unverified |

Character sets supported through browser `TextDecoder` include ASCII, UTF-8, common ISO-8859 sets, GBK/GB18030, and ISO-2022-JP. Unsupported character-set combinations are labeled rather than silently interpreted as ASCII. Enhanced MR metadata inspection exposes source functional groups; MPR has no newly fabricated DICOM instance.

## Memory and source policy

| Budget | Standard | Low memory |
| --- | --- | --- |
| Decoded image cache | 256 MiB | 128 MiB |
| Compressed source/instance read limit | 96 MiB | 48 MiB |
| Concurrent image reads/decodes | 2 | 1 |
| Resident distinct MPR volumes | Up to 2 | Up to 1 |
| Estimated active-volume admission | 640 MiB | 384 MiB |
| Export side / pixel cap | 4096 / 16 million | 2048 / 4 million |

MPR admission also limits the volume's native storage to 75% of the decoded-cache budget. The estimated volume cost is four times its scalar storage to reserve headroom for copies and GPU use. Geometry rejection or insufficient budget leaves acquired stacks available. Changing profile closes active views and releases their reconstruction resources; select a series again afterward.

ZIP limits are configurable constants: 20,000 entries, 128 MiB expanded per entry (further restricted by the selected read profile), and 8 GiB cumulative indexed expanded data per session. Actual extraction output and CRC are checked; encrypted, multipart, nested, duplicate-path, and unsupported-compression archives are rejected. Extraction is serialized and entries are re-read when needed. All caches are in-memory and browser process/GPU memory is not comprehensively observable, so these are admission policies, not guaranteed peak-memory bounds.

## Remaining release acceptance

- Real iPadOS and Android file selection, export/download, pinch transitions, portrait/landscape changes, GPU/context behavior, and memory pressure.
- Current Safari, Firefox, and Edge verification. Chromium touch emulation does not establish real-tablet support.
- Minimum-spec 8 GiB desktop / 4 GiB tablet profiling, cold/warm p95 latency, sustained achieved cine rate, multiple resident volumes, and GPU allocation limits.
- Generated 1 GiB and 5 GiB collections and a large multiframe benchmark. The sample measurements do not promise those scales.
- Trusted-viewer landmark comparison for anisotropic/oblique reconstruction and rescale/VOI/inversion, plus the additional codec/vendor fixtures above.
- Production host header validation beyond the included local preview configuration.

Offline app reopening, persistent sessions, registered cross-examination links, annotations, arbitrary oblique MPR, thick slabs, 3D rendering, and other imaging formats remain the planned future extensions.

## Engineering decisions

The source/format/catalog/controller/volume/export boundaries follow the plan. ZIP uses `@zip.js/zip.js` for Blob-backed random access rather than retaining a whole extracted archive. The Cornerstone metadata provider is registered through the supported core/metadata interface; the narrow DICOM adapter uses `dicom-parser` plus the pinned loader's dataset helpers to avoid retained duplicate datasets. Gesture and read-only tool dispatch is owned by the viewport controller; the separate Cornerstone tools package is not shipped before annotation tools are needed.

The lockfile overrides vulnerable transitive versions of `adm-zip`, `fflate`, and `uuid` with patched versions. Application ZIP handling uses zip.js. Browser aliases for `events` and `url` satisfy the pinned metadata dependency's browser imports. See [dependency licenses](dependency-licenses.md).

Vite explicitly prebundles codec factories and worker dependencies while excluding the DICOM loader. This fixes development-only CommonJS codec imports and prevents first-import dependency discovery from reloading an active examination.
