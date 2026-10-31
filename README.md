# Local MRI Viewer

Explore MRI scans in your browser. Open a DICOM folder, individual files, or a ZIP, browse slices, compare series, and view axial, sagittal, and coronal reconstructions.

**[Open the viewer](https://mri-viewer.haxoza.com)** · [Viewing guide](docs/viewing.md) · [Contributing](CONTRIBUTING.md)

Files are processed locally in your browser. There is no application backend or upload endpoint, and examinations are not saved between sessions.

## What you can do

- Browse slices with a mouse, keyboard, or touch, and play them as a cine loop.
- Compare up to four panes with optional linked navigation.
- Reconstruct compatible volumes in three planes (MPR).
- Inspect DICOM metadata, add simple screen marks, and export PNG/JPEG images.
- Optionally let a browser agent operate the viewer through WebMCP.

This is an experimental viewer, not a diagnostic tool. Compatibility varies by DICOM format and browser; see [supported formats and known limits](docs/implementation-status.md). Exports and screenshots can contain identifiers burned into source pixels. Images shared with an agent enter that agent's conversation.

## Run locally

You'll need **Node.js 24+** and npm.

```sh
git clone https://github.com/haxoza/mri-viewer.git
cd mri-viewer
npm ci
npm run dev
```

Open the localhost URL and choose **Open folder**, **Open files**, or **Open ZIP**. No sample scans? Run `node scripts/create-webmcp-sample.mjs` and open the generated synthetic folder.

## Learn more

- [Viewing guide](docs/viewing.md) – controls, comparisons, and experimental native-series linking.
- [Contributing](CONTRIBUTING.md) – development, tests, and handling private local data.
- [Agent tools](docs/webmcp.md) – WebMCP commands, screenshot sharing, and privacy boundaries.
- [Hosting](docs/hosting.md) – static deployment and security headers.
- [Implementation status](docs/implementation-status.md) and [plan](docs/plans/implementation-plan.md) – compatibility, validation, architecture, and future work.

Questions, bug reports, and contributions are welcome. Please use synthetic examples and keep patient data out of issues and pull requests.

## License

[MIT](LICENSE) © 2026 Przemek Lewandowski. Third-party components retain their own licenses; see the [dependency inventory](docs/dependency-licenses.md) and [notices](public/THIRD_PARTY_NOTICES.txt).
