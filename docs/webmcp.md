# Agent screenshot views and frozen exports

Start `npm run dev`, open its localhost URL in ChatGPT Work or Codex desktop,
load local files, and enable **Agent tools → Enable for this session**. Enabling
allows the listed operations until disabled or the page is closed/reloaded.
Unsupported browsers keep manual viewing, marks and exports. Registrations use
an `AbortSignal`, including when the browser has no `unregisterTool` method.

**DICOM files stay in this browser. Images shared with your desktop agent enter that agent's conversation.**
Pixels may contain burned-in identifiers. Processing and retention follow the
agent's configuration and service. No provider SDK, API key, backend, remote
assets, analytics or persistent examination storage is added.

## Why prepare a browser screenshot?

Checked on 2026-09-28: the [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
serializes imperative tool results as JSON. The [OpenAI site-tools documentation](https://learn.chatgpt.com/docs/webmcp)
describes operating and inspecting a shared live page, but does not document an
image attachment result contract. Returning base64 inside JSON is therefore not
a verified way to deliver model-visible image content. This viewer prepares the
page and explicitly asks the agent to take a browser screenshot. Native support
for image results could be revisited if a documented contract becomes available.

## Viewing and sharing

- Choose **Ellipse**, a red/yellow/cyan color, and drag on a pane. **Undo mark**
  reverses the last annotation edit; **Clear marks** clears the active pane.
  Marks use normalized screen coordinates and remain fixed through navigation,
  pan, zoom and resizing. They have no anatomical tracking or measurement meaning.
  Removing the examination or reloading clears them.
- For manual use, choose **Screenshot view** beside Export, then **Active pane**
  or **Whole workspace**. Agent tools do not need to be enabled or supported.
  This only prepares the view; take the screenshot with your usual browser/OS tool.
- Ask the agent to call `capture_view` for the active pane, a specified visible
  pane, or workspace. It pauses cine, hides app controls/sidebar/navigation,
  expands the view, waits for rendering and returns safe pane context. It does
  not encode an image, open Export, download anything or send image bytes.
- The agent takes a **browser screenshot** once the tool succeeds. The compact
  bar reads **Live view** and **Ready for screenshot**. Pane numbers, session-only
  **View N** labels, orientation, slice/plane positions and screen marks remain
  visible. View labels match the tool catalog; DICOM series descriptions are
  hidden in this mode. Source pixels can still contain identifiers.
- This is live: navigation changes the pixels and labels. The bar reports
  **Changed since preparation** when viewing context changes; call `capture_view`
  again before inspecting the next screenshot. `get_viewer_state.screenshot`
  exposes the preparation ID, isolated pane (null for workspace) and changed flag.
- **Restore controls**, **Escape**, or `close_capture` exits screenshot mode.
  Tool disable/unmount and failed/cancelled preparation also restore controls.
  The original layout, sidebar preference and pane instances are retained.
  Layout changes or `open_mpr` exit isolation before changing the workspace.
  Cine stays paused after restoration.
- Close an open modal before calling `capture_view`; the tool reports an error
  instead of discarding a frozen export or capturing an obscuring dialog.
- **Export** remains a separate frozen-image workflow. It opens a preview with
  capture ID, dimensions and pane positions. Navigation leaves it unchanged;
  output-setting changes automatically refresh the preview. If the viewer changes,
  choose **Capture current view** to update it. Failed captures offer **Retry preview**. **Download image** always downloads the
  displayed capture, including its format/dimensions, then closes the dialog.
  Only one frozen image is retained; replacement/close revokes its object URL.

## Command contract

Panes and positions are one-based. Aliases and View labels are session-only;
read `get_viewer_state` for the current catalog. Results omit DICOM UIDs, dates,
filenames and unrestricted metadata/free text.

| Tool | Arguments |
| --- | --- |
| `get_viewer_state` | `{}` |
| `set_layout` | `layout`: single, columns-2, rows-2, left-3, top-3, grid-4, columns-4, rows-4 |
| `set_active_pane` | `pane` |
| `assign_view` | `pane`, `displaySet` alias, `mode`: acquired/axial/sagittal/coronal |
| `set_slice` | `pane`, `position` |
| `set_view` | `pane`; optional `width` + `center`, `zoom` (0.05–30), `dx` + `dy` in CSS pixels, `operation`: fit/reset |
| `set_native_links` | `enabled` boolean |
| `set_linked` | `pane`, `linked` boolean |
| `open_mpr` | `pane` |
| `set_crosshair` | `pane`, normalized `x`, `y` |
| `edit_annotations` | `pane`, `action`: add/update/remove/undo/clear; add/update requires `ellipse: {id,x,y,rx,ry,color}`, remove requires `id` |
| `capture_view` | optional `scope`: active/workspace (default active); optional `pane` for an individual pane |
| `close_capture` | `{}`; restore controls and close any frozen Export preview |

Tools return `{ok:true,result}` or `{ok:false,error}`. `capture_view` returns
`captureId` (a preparation ID, not a stored image), `live:true`, CSS-pixel `width`
and `height`, selected `panes` with catalog aliases/labels, displayed/requested
positions, readiness, viewing settings and annotations, plus screenshot instructions.
It retains the existing tool name and argument schema, but replaces the former
frozen-image result semantics. Empty/unavailable targets and contradictory scope
arguments fail explicitly. Success describes the settled view at return time;
subsequent human/agent actions can change it before the browser screenshot.

Mutation calls serialize and wait for rendering, including linked panes and MPR.
Calls have a 60-second budget and bounded render waits. Human gestures and tool
cancellation supersede pending work; read current state before retrying. Disable
aborts active/queued calls and unregisters tools, including late registrations.

`src/app/actions.ts` contains shared typed operations;
`src/features/agent/commands.ts` validates and schedules calls;
`src/features/agent/webmcp.ts` manages browser registrations;
`screenshot.ts` and `ScreenshotBar.tsx` manage live screenshot presentation.
Export and annotations remain independently usable.

## Verification

The original desktop tool-discovery check passed on 2026-09-26: enabling tools
exposed 12 registrations and disabling removed them. The user subsequently
reported that ChatGPT Work opens Export via `capture_view`, then screenshots it.

On 2026-09-28, the live localhost Chrome viewer was loaded with seven generated
synthetic slices and Export at slice 2 was inspected through accessibility.
The existing Chromium WebMCP test-double workflow passed before implementation;
its screenshot confirmed the red ellipse and slice 2, a preview capped at 55vh,
small captions and export controls extending below the fold. Frozen navigation
and byte-identical downloads passed. The native desktop bridge was unavailable
in this coding session; desktop UI access was blocked, and native Chrome's
screenshot capture returned blank. Visual review used synthetic Chromium test
artifacts. This is not a new native ChatGPT Work integration certification.

Browser regressions cover live pane isolation, ready/changed state, restoration,
cancellation, linked/MPR settlement, renderer preservation, privacy, frozen
preview/downloads, high-DPI exports and delayed registration/encoding.
Validation passed on 2026-09-28: `npm run check` (lint, 18 unit tests, type
checking, build and privacy guard), all 22 production browser tests, and all 22
development-server browser tests. Commands: `npm run test:e2e` and
`VIEWER_DEV=1 npm run test:e2e`.

For a native desktop follow-up:

1. Run `node scripts/create-webmcp-sample.mjs` and load the generated folder
   from ignored `local-data/` in the localhost viewer.
2. Enable tools, set slice 2 and add an ellipse with the agent.
3. Call `capture_view`, then take a browser screenshot. Confirm the pane, View
   label, slice and ellipse are readable and app controls are hidden.
4. Set slice 3. Confirm live pixels/labels change and the bar reports a changed
   view. Prepare again, screenshot, and call `close_capture`.
5. Check workspace and individual MPR panes, **Restore controls**, and Escape.
6. Record the desktop app version, selected model and native tool results.

## CI export regression

The [September 25 CI run](https://github.com/haxoza/mri-viewer/actions/runs/36193054655)
failed two MPR export tests while the Download button was still disabled after
preview refresh. Both used Playwright's default five-second assertion timeout,
although captures have a 60-second application budget. The WebMCP capability
changes did not address these export waits.

A six-second encoding delay reproduces the original assertion failure. Export
tests now wait for refresh completion within that budget, check for an error and
require a new preview URL before downloading. Download event listeners start
only after refresh succeeds, avoiding secondary errors when refresh fails.
The two workflows with multiple MPR captures also have a longer overall test budget.

## Linked native series

WebMCP can configure native linking without toolbar interaction: call `set_layout`, `assign_view` with `mode: "acquired"`, `set_native_links({"enabled": true})`, and `set_linked` for each pane. Then use `set_crosshair` with normalized pane coordinates and `set_slice` for physical navigation. Repeating `set_native_links` with the current value preserves the selected point. `get_viewer_state` reports `nativeLinks`, catalog `nativeLinkable`, and per-pane `nativeLink` status, nearest slice, displayed-plane offset in mm, coverage and reference relationships (`intersecting`, `coincident`, `parallel`, `outside-image`, or `incompatible`). These diagnostics expose neither identifiers nor patient-space coordinates. Set `enabled: false` to restore parallel-stack linking. The private verifier's optional `--three` flag also checks the third coronal series and coincident-reference annotations.
