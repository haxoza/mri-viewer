# Agent tools and frozen captures

Start `npm run dev`, open its localhost URL in Codex desktop, load local files,
and enable **Agent tools → Enable for this session**. Enabling allows all listed
viewer operations and captures until disabled or the page is closed/reloaded.
If the browser lacks `document.modelContext.registerTool` / `unregisterTool`,
the control explains that tools are unavailable; manual viewing, marks and exports
remain usable.

**DICOM files stay in this browser. Images shared with your desktop agent enter that agent's conversation.**
Captured pixels may contain burned-in identifiers. Agent processing and retention
follow your Codex configuration and service. No provider SDK, API key, backend,
remote assets, analytics or persistent examination storage is added.

## Viewing and sharing

- Choose **Ellipse**, a red/yellow/cyan color, and drag on a pane. **Undo mark**
  reverses the last annotation edit; **Clear marks** clears the active pane.
  Marks are normalized screen coordinates. They remain fixed through navigation,
  pan, zoom and resizing, without anatomical tracking or measurements. Removing
  the examination or reloading clears them.
- **Export** pauses cine and opens a frozen preview with a capture ID, dimensions
  and pane positions. Change output settings then choose **Refresh preview**.
  **Download image** always downloads the displayed capture, including its format
  and dimensions, and closes the dialog.
- Ask the agent to call `capture_view` for the active pane, a specified visible
  pane, or workspace. It opens the same preview. Ask the agent to inspect it using
  a browser screenshot. Serialized tool results contain context, not image bytes.
- Navigation leaves a preview unchanged. Capture again to discuss another view.
  Only one preview is retained; replacing or closing it revokes its object URL.

## Command contract

All panes and positions are one-based. Display-set/study/series aliases are valid
only in this page session. Read `get_viewer_state` to obtain them. Returned state
contains only numeric viewing context, readiness, screen marks, derived orientation
and dimensions/counts; it omits DICOM UIDs, dates, filenames and free-text metadata.

| Tool | Arguments |
| --- | --- |
| `get_viewer_state` | `{}` |
| `set_layout` | `layout`: single, columns-2, rows-2, left-3, top-3, grid-4, columns-4, rows-4 |
| `set_active_pane` | `pane` |
| `assign_view` | `pane`, `displaySet` alias, `mode`: acquired/axial/sagittal/coronal |
| `set_slice` | `pane`, `position` |
| `set_view` | `pane`; optional `width` + `center`, `zoom` (0.05–30), `dx` + `dy` in CSS pixels, `operation`: fit/reset |
| `set_linked` | `pane`, `linked` boolean |
| `open_mpr` | `pane` |
| `set_crosshair` | `pane`, normalized `x`, `y` |
| `edit_annotations` | `pane`, `action`: add/update/remove/undo/clear; add/update requires `ellipse: {id,x,y,rx,ry,color}`, remove requires `id` |
| `capture_view` | optional `scope`: active/workspace; optional `pane` for an individual pane |
| `close_capture` | `{}` |

Tool calls return `{ok:true,result}` or `{ok:false,error}`. Mutation calls serialize
and wait for rendering, including linked panes and MPR. Calls have a 60-second
budget and render waits are bounded. Human gestures or tool cancellation supersede
pending work; read current state before retrying. Disabling tools aborts active and
queued calls and unregisters tools, including registrations that finish late.

`src/app/actions.ts` contains typed operations shared with UI controls;
`src/features/agent/commands.ts` validates and schedules calls;
`src/features/agent/webmcp.ts` handles the browser API lifecycle. Capture and
annotation services are usable independently of WebMCP.

## Verification status and deferred desktop check

Local validation passed: `npm run check` (16 unit tests, lint, type check, build
and privacy guard), plus all 17 browser tests against both production and
development servers. High-DPI capture and annotation pixels are included.

Automated tests use generated synthetic DICOM, an imperative WebMCP test double,
and real Chromium rendering. This verifies application behavior, not native Codex
site-tool discovery or image inspection.

**Codex desktop/model combination verified: none yet.** On 2026-09-25 the in-app
browser was unavailable to this development session. The live check is deferred
at the user's request until they return to the keyboard in this same session.

When available:

1. Run `node scripts/create-webmcp-sample.mjs` to create seven synthetic slices
   under ignored `local-data/`. Start `npm run dev` and open the localhost URL
   in Codex desktop.
2. Load synthetic DICOM and enable Agent tools. Discover `get_viewer_state`.
3. Set slice 2, add a colored ellipse, then call `capture_view`.
4. Inspect the visible preview using Codex's screenshot capability and confirm
   the mark and slice label are readable.
5. Navigate to slice 3; confirm the original preview remains on slice 2. Capture
   again, close the capture, then disable tools and confirm they disappear.
6. Record the actual desktop app version, selected model, and result here.

Run `npm run check`, `npm run test:e2e` and
`VIEWER_DEV=1 npm run test:e2e` for automated validation.

API references: [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp) and
[WebMCP specification](https://webmachinelearning.github.io/webmcp/).
