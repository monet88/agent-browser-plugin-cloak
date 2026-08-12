# agent-browser-plugin-cloak

Thin `browser.provider` plugin for `agent-browser` that launches CloakBrowser and exposes it over CDP.

## Requirements

- Node.js 20+
- `agent-browser` with plugin support (tested with `0.33.2`)
- A CloakBrowser Chromium build installed in `~/.cloakbrowser`

Install the default bundled/keyless CloakBrowser build once:

```bash
npx cloakbrowser install
```

## Install

Use the GitHub source now:

```bash
agent-browser plugin add monet88/agent-browser-plugin-cloak --global
agent-browser plugin show cloak
```

When the npm package is available, you can use `agent-browser plugin add agent-browser-plugin-cloak --global` instead.

Then use it as the browser provider:

```bash
agent-browser --provider cloak open https://example.com
```

## Binary modes

The provider supports three binary-selection modes:

- `bundled` (default): use the wrapper-bundled/keyless CloakBrowser build from `~/.cloakbrowser`.
- `latest`: let the CloakBrowser SDK resolve the latest build for the current login/license state.
- `explicit`: use `executablePath`, `CLOAKBROWSER_PATH`, or `CLOAKBROWSER_BINARY_PATH` exactly.

An explicit path automatically selects `explicit` when no mode is configured.

## Environment

```text
CLOAKBROWSER_BINARY_MODE=bundled|latest|explicit
CLOAKBROWSER_PATH=C:\path\to\chrome.exe
CLOAKBROWSER_BINARY_PATH=C:\path\to\chrome.exe
CLOAKBROWSER_CACHE_DIR=C:\custom\cache
CLOAKBROWSER_HOST=127.0.0.1
CLOAKBROWSER_PORT=0
CLOAKBROWSER_START_TIMEOUT=15000
CLOAK_PLUGIN_LOG=C:\path\to\plugin.log
```

The response metadata includes `binaryMode` and `executablePath`, so logs can prove which CloakBrowser binary was launched. Each account/session receives its own fingerprint seed and temporary profile unless a profile is supplied explicitly.

## Local development

```bash
npm run build
npm test
npm pack
```

The npm executable is `agent-browser-plugin-cloak` and points to `dist/cli.js`. The source adapter at `scripts/plugin-stdio.ts` is only a development wrapper around the same CLI implementation.

## Release

```bash
npm whoami
npm publish --access public
```

`prepublishOnly` runs the test suite and `prepack` rebuilds `dist` before npm creates the release tarball.
