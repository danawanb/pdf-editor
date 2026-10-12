# PDF Editor

An offline desktop app to **merge**, **split** and **edit** PDFs on macOS and Windows, built with Tauri 2, Rust and Svelte 5.

## Features
- **Merge PDF**: pick or drop several files and reorder them with drag & drop.
- **Split PDF**: one file per page, custom ranges (`1-3, 5, 8-10`), or every N pages.
- **Edit PDF**: rotate, delete, duplicate and reorder pages. Add text, images, signatures, highlights, freehand drawings, and rectangles, circles or triangles with an optional fill color and opacity.

## Architecture
- `src-tauri/src/pdf_ops.rs`: page operations with `lopdf`. Every operation goes through a single `assemble` function.
- `src/lib/annotate.ts`: writes annotations into the PDF with `pdf-lib`, including on rotated pages.
- `src/lib/pdfjs.ts`: renders pages with `pdfjs-dist`.

## Development
```sh
npm install
npm run tauri dev
```

## Tests
```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run check
```

## Build
```sh
npm run tauri build          # macOS: .app + .dmg in src-tauri/target/release/bundle/
```

## CI/CD
- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every PR, runs type-checks, the frontend build and Rust tests on macOS and Windows runners.
- **Release** (`.github/workflows/release.yml`): builds one installer per OS, a universal macOS `.dmg` (Apple Silicon + Intel) and a Windows `-setup.exe`, then publishes them as a GitHub Release.

To cut a release:
1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`), e.g. `0.2.0`, and commit.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`

The workflow fails early if the tag doesn't match the app version. If any platform fails, the release stays a draft.

macOS builds are ad-hoc signed but not notarized, so on first launch users need to right-click the app and choose **Open**.
