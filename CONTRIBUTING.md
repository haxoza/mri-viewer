# Contributing

Thanks for helping improve Local MRI Viewer. Bug reports, documentation fixes, and focused pull requests are welcome.

## Getting started

Use Node.js 24+ and npm. Clone the repository, run `npm ci`, then `npm run dev`.
The app uses React, TypeScript, Vite, and Cornerstone. Start with [the implementation status](docs/implementation-status.md) for architecture, compatibility, and known gaps.

No examination of your own is needed. Generate a small synthetic sample:

```sh
node scripts/create-webmcp-sample.mjs
```

Open the printed folder in the viewer. Generated files stay in ignored `local-data/`.

## Checks

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

## Reporting issues and opening pull requests

Include steps to reproduce, expected and actual behavior, and your browser/OS versions. Use synthetic data when demonstrating a problem. For a code change, add a focused regression test where useful and run the checks above, including browser tests for viewer changes.

Do not attach real examinations, reports, metadata dumps, or screenshots containing patient information to issues or pull requests. Removing a name from a filename does not anonymize DICOM metadata or burned-in pixel labels. Keep credentials and `.env` files out of commits as well.

## Private local verification

Keep real examinations, reports, archives, screenshots, and metadata dumps under ignored `local-data/` or `exports/`. Never force-add them. The Vite development server denies private paths, including absolute and encoded variants. CI uses only generated synthetic fixtures and does not upload test artifacts.

With the production preview running, this optional check decodes every selected sample image and prepares one three-plane reconstruction:

```sh
node scripts/verify-private-sample.mjs local-data/dicom
node scripts/verify-private-sample.mjs local-data/dicom --zip
```

Set `VIEWER_URL` if using another local port. The ZIP check creates a temporary archive under `local-data/verification/` and removes it afterward. These checks emit aggregate counts and timing only; they do not save screenshots, traces, or raw metadata. They are excluded from CI.

For native-series checks, see the [viewing guide](docs/viewing.md#linked-native-series-experiment). Agent integration and desktop checks live in [docs/webmcp.md](docs/webmcp.md).

Before sharing a branch, review `git diff --cached` and run `npm run check:privacy`. To scan Git history for credentials with [Gitleaks](https://github.com/gitleaks/gitleaks) installed:

```sh
gitleaks git --redact --log-opts=--all .
```

The privacy guard checks medical paths and DICOM signatures; it is not a complete secret or patient-data detector. Review text and image content too. CI uses synthetic data and does not upload test artifacts.

## License

Contributions are made under the project's [MIT license](LICENSE). Third-party components retain their own licenses and notices.
