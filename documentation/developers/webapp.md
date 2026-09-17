# Web App

The Web App sources are located in `src/webapp`. Installations download and
serve pre-built static assets, so Node.js and local compilation are not
required on the target system.

## CI bundles

Every Web App bundle is addressed by its source commit:
`webapp-build-<first 10 commit characters>.tar.gz`. The installer accepts only
a bundle matching the checked-out commit. It checks the source repository and,
for forks, the upstream repository:

1. The `webapp-development` prerelease for development installs.
1. The release matching the Jukebox version.

There is no fallback to a bundle from another commit. If no exact bundle is
available, publish or rerun the `Test Build Web App v3` workflow for that
commit, then rerun the installation. The legacy
`ENABLE_WEBAPP_PROD_DOWNLOAD=false` local-build mode is unsupported.

Pushes to any version 3 branch retain the exact bundle as a GitHub Actions
artifact for 14 days and publish it to the `webapp-development` prerelease.
Branch names are unrestricted: branches created from version 3 inherit this
workflow, while incompatible legacy branches do not contain it. The workflow
can also be run manually for a selected branch. Pull request workflows remain
read-only and do not publish bundles.

For a fork:

1. Open the fork's **Actions** tab and enable workflows. If GitHub lists
   `Test Build Web App v3` as disabled, enable that workflow as well. If the
   workflow is not listed, set the fork's default branch to `future3/develop`.
1. Under **Settings > Actions > General > Workflow permissions**, select
   **Read and write permissions** so the workflow can publish the bundle.
1. Push the commit to a branch with any name, or select that branch when
   starting `Test Build Web App v3` manually.
1. Wait for the workflow to complete before running the installer.

### Download a CI bundle manually

Signed-in developers can download a retained workflow artifact with the GitHub
CLI:

```bash
gh run download RUN_ID \
  --repo OWNER/RPi-Jukebox-RFID \
  --name webapp-build-0123456789.tar.gz
```

GitHub Actions artifacts require authentication. The installer uses public
release or prerelease assets.

## Develop the Web App

The Web App is a React application built with Vite. Use Node.js 22 and npm 10
or newer on a workstation or in the provided Docker environment:

```bash
cd ~/RPi-Jukebox-RFID/src/webapp
npm ci
npm run dev
```

The development server listens on port `3000` and proxies `/api/` to
`http://localhost:5556`. Set `API_PROXY_TARGET` to use another Jukebox API
server. `/cover-cache/` is forwarded as well: nginx serves the cover cache from
the Web App build directory, which the development server does not serve
itself.

## Backend API

The Web App uses `POST /api/v1/rpc` for commands and `WS /api/v1/events` for
state updates. Both are served on the configured API port, `5556` by default,
and nginx exposes them under the same origin as the Web App.
`GET /api/v1/health` reports API availability.

Library file management uses dedicated HTTP endpoints under
`/api/v1/library/`. Uploads send one raw file per
`PUT /api/v1/library/files` request so Tornado can stream it to storage without
buffering the complete file in memory. Browser folder selections retain their
relative paths; the Web App creates the selected folder trees through the
`folders` endpoint before uploading their files sequentially. Raw directory
listing, batch deletion, and MPD refresh use the corresponding `entries` and
`refresh` endpoints. nginx disables request buffering only for the upload
endpoint; RPC and other JSON requests retain their 1 MiB limit.

The old ZeroMQ-over-WebSocket endpoints on ports `5556` and `5557` were
intentionally removed. Native ZeroMQ clients remain wire-compatible on TCP RPC
port `5555` and publishing port `5558`.

## Kiosk and touch displays

The Web App runs on small touch panels in kiosk mode as well. The reference
device is a 7 inch panel with 1024 x 600 CSS pixels, where one CSS pixel
measures 0.15 mm.

The sizes are CSS custom properties in `src/webapp/src/index.css`, which
`src/webapp/src/index.jsx` imports. The MUI theme in `src/webapp/src/theme.js`
reads them through `var(...)` and defines no sizes of its own.

- `--touch-min` (48 px) is the lower bound for everything clickable;
  `--touch-comfort`, `--touch-secondary` and `--touch-primary` follow at 56,
  64 and 96 px. The icon sizes derive from them.
- On a coarse pointer (`@media (pointer: coarse)`) the touch tokens scale with
  the short viewport edge, so a denser panel of the same physical size keeps
  the millimetre minimum. The upper bounds of the `clamp()` expressions keep a
  large touch screen from inflating the controls.
- The shell limits its width to `min(100%, 1100px)` for readability. The
  bottom navigation carries the same limit, so its tabs line up with the
  content.
- The type scale uses `clamp()` with `min(vw, vh)`, so a title grows with both
  axes and still fits on a wide but low viewport.

The Playwright projects `mobile` (375 x 812) and `kiosk` (1024 x 600) emulate a
coarse pointer with `hasTouch: true`; that is what makes the token tier apply
during a test run. `e2e/layout.js` holds the shared invariants.
`e2e/layout.spec.js` checks the touch minimum, the shell width, the missing
dead space and the scroll behaviour of every route, `e2e/settings.spec.js`
checks the collapsed settings sections.

Reference images are stored per route and project. Update them per route and
look at each generated image:

```bash
cd src/webapp
npx playwright test --update-snapshots -g 'route renders'
```

## Checks and production build

Run the same checks used by CI:

```bash
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm run build` writes the production assets to `src/webapp/build`. CI packages
that directory without source maps as the commit-addressed installation
bundle.
