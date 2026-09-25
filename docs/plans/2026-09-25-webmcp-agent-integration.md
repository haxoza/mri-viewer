# Local MRI viewer integration with Codex through WebMCP

## Summary

Expose the MRI viewer's capabilities through **WebMCP**, enabling human–agent collaboration on the same live page.

Run the application using its existing Vite development server on localhost. Open it in Codex's built-in browser, load local DICOM files, and use Codex to inspect selected image previews and operate the viewer through structured tools.

DICOM files, decoding, rendering, and annotations remain in browser memory. Images inspected by Codex enter its model conversation.

WebMCP availability depends on the desktop app, model, and rollout. Verify compatibility locally before building the complete tool set. [Official site-tools documentation](https://learn.chatgpt.com/docs/webmcp)

The user workflow:

1. Start the viewer with `npm run dev` and open its localhost URL in Codex.
2. Select local DICOM files and enable agent tools for this session.
3. Navigate and optionally draw colored ellipses over a pane.
4. Ask Codex to inspect that pane or the visible workspace.
5. Discuss the images and request viewer operations.

## Viewer experience and image sharing

- Add an **Agent tools** control with session-only enable/disable, availability status, and brief usage instructions. Enabling grants access to the loaded session without additional application confirmation for each capture or navigation.
- Extend the existing **Export** dialog with a frozen image preview. Retain its active-pane/workspace selector, output settings, and download functionality. Changing capture settings requires refreshing the preview; downloads use the displayed capture.
- Reuse the export renderer to capture the current slice, windowing, crop, zoom, and annotations. Workspace captures preserve the visible pane arrangement and exclude hidden panes and sidebar content.
- Show the captured image prominently, with a capture identifier, pane labels, and slice/plane positions. Keep one capture in memory and revoke its object URL when replaced or closed.
- WebMCP opens this same preview directly. Codex then inspects it using its browser screenshot capability. Do not assume that returning base64 text delivers a model-visible image: WebMCP specifies serialized tool results. [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- Preserve aspect ratio and existing export memory limits. Agent captures default to PNG at displayed pixel dimensions, capped by those limits. Support individual-pane captures when workspace previews make details too small.
- Navigation does not update an existing capture. A new capture is required to discuss a different view.

**Annotations:** add an SVG overlay over each imaging pane, with ellipse drawing, red/yellow/cyan selection, undo, and clear. Store normalized pane coordinates. Marks remain at the same relative screen position through slice changes, pan, zoom, and layout resizing until cleared; removing the examination or reloading clears them. Describe these as screen marks without anatomical tracking or measurements. Drawing mode intercepts gestures only while selected.

## Application interface and WebMCP tools

Create a typed application command layer shared by UI actions and WebMCP handlers. Reuse existing controllers and export logic rather than manipulating DOM controls or exposing the store directly.

Register these tools through the top-level page's imperative `document.modelContext` API:

| Tool | Contract |
|---|---|
| `get_viewer_state` | Return layout, active pane, displayed/requested positions, readiness, viewing settings, annotations, and loaded-series catalog. |
| `set_layout` | Select an existing supported layout. |
| `set_active_pane` | Select a visible pane, numbered 1–4. |
| `assign_view` | Assign a session-scoped display-set ID and acquired/axial/sagittal/coronal mode to a visible pane. |
| `set_slice` | Navigate to an absolute, one-based slice or reconstructed-plane position. |
| `set_view` | Apply window width/center, absolute zoom, pan delta in CSS pixels, or existing Fit/Reset operations. |
| `set_linked` | Enable or disable existing pane linking. |
| `open_mpr` | Open the existing three-plane reconstruction for the selected pane. |
| `set_crosshair` | Position the MPR crosshair using normalized pane coordinates. |
| `edit_annotations` | Add/update/remove an ellipse by ID, undo, or clear a pane's marks. |
| `capture_view` | Capture the active pane, a specified visible pane, or workspace; open the Export preview and return its identifier, dimensions, and pane context. |
| `close_capture` | Close the preview and release its image resources. |

Implementation requirements:

- Use session-scoped aliases for studies/display sets. Expose orientation, dimensions, counts, and numeric viewing context; omit patient identifiers, dates, filenames, DICOM UIDs, and unrestricted metadata/free-text descriptions.
- Validate arguments at runtime. Return explicit errors for unavailable panes, invalid positions, unsupported reconstruction, or insufficient memory.
- Serialize state-changing tool calls. Resolve success only after affected panes finish rendering, including linked panes and MPR.
- Track state revisions and controller generations. If human interaction supersedes an operation, report that outcome rather than claiming its target remains displayed.
- Capture pauses cine, waits for settled frames, and freezes image state and annotations together. Failed or superseded captures must not present mismatched pixels and labels.
- Support cancellation and bounded waits. Disabling tools unregisters them and cancels outstanding work. Registration must survive React lifecycle changes without duplicates.
- Separate the WebMCP adapter from application commands so future integrations can reuse the command layer.

Bulk examination export, filesystem access, arbitrary JavaScript execution, and autonomous scanning workflows are outside this release.

## Privacy and local operation

- Keep the existing localhost development workflow and private-file serving restrictions.
- Use bundled dependencies without analytics, remote runtime assets, provider SDKs, or API-key storage. WebMCP executes in the page and requires no application backend or local companion process.
- Keep examination data, annotations, and captures out of persistent browser storage, URLs, logs, and telemetry.
- State the privacy boundary clearly: **“DICOM files stay in this browser. Images shared with your desktop agent enter that agent's conversation.”** Captured pixels can still contain burned-in identifiers.
- Feature-detect WebMCP. Unsupported browsers retain manual viewing, annotation, preview, and export.
- Document the Codex app/model combination actually verified locally. Agent processing and retention follow the user's Codex configuration and service.

## Validation and delivery

1. **Verify the integration first:** run the development server, open it in a supported Codex browser, discover a tool, change a synthetic slice, open a capture, and confirm Codex can visually inspect it.
2. **Test commands:** argument validation, one-based indexing, linked settlement, MPR failures, cancellation, concurrent calls, and human supersession.
3. **Test pixels and annotations:** acquired and MPR captures, 1–4-pane layouts, windowing, zoom, aspect ratio, high-DPI scaling, annotation persistence, and unchanged viewer pixels after export cleanup.
4. **Test the Export workflow:** capture refresh, frozen previews during navigation, PNG/JPEG downloads matching the preview, and image-resource cleanup.
5. **Test privacy and lifecycle:** no examination payloads in network requests or storage; tool disable/unmount cleanup; unsupported-browser fallback; existing import and offline workflows remain functional.
6. Run `npm run check`, the existing production browser suite, and development-server browser tests with `VIEWER_DEV=1 npm run test:e2e`. Use synthetic data for automated tests and the Codex integration smoke test.

**Acceptance criterion:** using the localhost viewer in Codex, a user can discuss a marked slice or workspace and ask Codex to operate the viewer, while the application processes the examination entirely in the browser.
