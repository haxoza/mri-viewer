# MRI Viewer

Planning a React + TypeScript web application for viewing locally selected MRI files without uploading medical data.

See [the implementation plan](docs/plans/implementation-plan.md) for the proposed architecture, scope, research, milestones, and open product decisions. Application implementation has not started.

## Local sample data

The private sample is copied into `local-data/dicom/`. This entire directory is ignored by Git, including extensionless files. Common medical image extensions are also ignored throughout the repository.

Keep all real examinations, reports, archives, derived images, screenshots, and metadata dumps under `local-data/` or `exports/`. Don't place them in `public/`, source files, documentation, test snapshots, or committed test fixtures. Don't force-add ignored data. Use synthetic data for committed tests.

The future application should open these files through the browser's file/folder picker. It must not serve this directory as static assets. Local development servers should explicitly deny access to private data directories.
