# Vraxis Desktop

Turn your web app into a desktop app.

Vraxis Desktop gives your app an Electron shell, secure browser defaults, and one config file. Use it with a hosted app, static build, or local service.

## Get started

```bash
npm install --save-dev @vraxis/desktop
npx vraxis-desktop init
npx vraxis-desktop validate
npx vraxis-desktop dev
npx vraxis-desktop test-package
npx vraxis-desktop release
```

`init` creates `vraxis.desktop.config.mjs`. `validate` catches config errors before Electron starts. `dev` opens the desktop app for local testing.

`test-package` builds the app, launches it, checks the loaded page, and shuts it down. On macOS, `release` creates an unsigned `.dmg` and a release manifest with its SHA-256 checksum.

## Choose your app source

Vraxis Desktop supports three source types:

| Source | Use it for | What runs |
|---|---|---|
| `remote` | A trusted hosted app | An HTTPS URL |
| `static` | A built web app that should work offline | Bundled HTML, CSS, and JavaScript |
| `service` | A local-first app with its own server | A bundled Node service or local command |

## Configure the desktop app

Create `vraxis.desktop.config.mjs`:

```js
import { defineDesktopApp } from "@vraxis/desktop";

export default defineDesktopApp({
  schemaVersion: 1,
  app: {
    id: "my-app",
    name: "My App",
    bundleId: "io.example.my-app",
  },
  source: {
    kind: "static",
    directory: "dist",
  },
  branding: {
    icon: "assets/icon-1024.png",
    macIcon: "assets/icon.icns",
    windowsIcon: "assets/icon.ico",
    linuxIcon: "assets/icon.png",
    logo: "assets/logo.svg",
    backgroundColor: "#202529",
  },
  window: {
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
  },
  security: {
    externalLinks: "browser",
    allowedNavigationOrigins: [],
    permissions: [],
  },
  integrations: {
    directoryPicker: {
      title: "Choose a folder",
      buttonLabel: "Choose folder",
    },
    protocols: [{ scheme: "my-app" }],
    fileAssociations: [{ extensions: ["md"], role: "Editor" }],
  },
  packaging: {
    outputDirectory: "out",
    asar: true,
    appCategoryType: "public.app-category.productivity",
  },
});
```

When `app.version` is missing, Vraxis Desktop reads it from the nearest `package.json`.

## Choose a directory

Enable the native directory picker for a static app or local service:

```js
integrations: {
  directoryPicker: {
    title: "Choose a library folder",
    buttonLabel: "Observe folder",
  },
}
```

The renderer receives one method:

```ts
const selected = await window.vraxisDesktop?.chooseDirectory();
if (!selected?.cancelled && selected.path) {
  await observeFolder(selected.path);
}
```

The bridge does not expose Electron, Node.js, or general filesystem access. The main process accepts calls only from the app window. Remote web sources cannot enable this capability.

## Bundle a local service

Prepare a directory with your built server and its production dependencies. Vraxis Desktop copies it into the app's Resources directory.

```js
source: {
  kind: "service",
  authentication: "desktop-token",
  bundle: {
    directory: "desktop-service",
    entry: "server/index.js",
  },
  url: "http://127.0.0.1:{port}/app",
  healthcheck: "http://127.0.0.1:{port}/api/health",
  readyTimeoutMs: 30_000,
}
```

The packaged app runs the entry file with Electron's Node runtime. Users do not need Node or a global service command.

`desktop-token` gives the service a new random token for each launch. Vraxis Desktop uses it for the health check and adds it to the first app URL. The service must exchange that token for its own protected browser session.

The service starts from its bundled directory. Relative paths to UI files and other resources continue to work.

## Run an installed command

Use `{port}` when your app needs a free loopback port:

```js
source: {
  kind: "service",
  authentication: "desktop-token",
  command: "my-app-server",
  args: ["--port", "{port}"],
  url: "http://127.0.0.1:{port}/app",
  healthcheck: "http://127.0.0.1:{port}/api/health",
  readyTimeoutMs: 30_000,
  environment: {
    inherit: ["OPENAI_API_KEY"],
    set: { APP_MODE: "desktop" },
  },
}
```

Vraxis Desktop starts the command without a shell. It waits for the health check before it opens the window.

Keep credentials out of `environment.set`. List credential names in `environment.inherit` so their values are read at runtime.

The service command must exist on the destination machine. Use a bundled service when the app should install as one standalone product.

## CLI commands

| Command | What it does |
|---|---|
| `vraxis-desktop init` | Creates a starter config file |
| `vraxis-desktop validate` | Checks config, paths, URLs, and security rules |
| `vraxis-desktop inspect` | Prints the resolved config without opening Electron |
| `vraxis-desktop dev` | Opens the app in a local Electron session |
| `vraxis-desktop package` | Builds an unsigned app bundle for the current platform |
| `vraxis-desktop test-package` | Builds and smoke-tests the packaged app |
| `vraxis-desktop release` | Creates a macOS disk image and release manifest |

## Build a macOS release

Create an unsigned disk image without an Apple Developer account:

```bash
npx vraxis-desktop release --arch arm64
```

The command smoke-tests the packaged app before it creates the disk image. Pass `--no-smoke` only when the same artifact already passed the test.

The release manifest records the product, version, update channel, platform, architecture, file size, download URL, and SHA-256 checksum. Vraxis CLI can use this contract to verify future installs and updates.

### Sign and notarize

After you have an Apple Developer ID certificate, pass its identity:

```bash
npx vraxis-desktop release \
  --sign "Developer ID Application: Example Company (TEAMID)"
```

Add `--notarize` after you configure one of these credential sets:

```bash
# Preferred for a developer machine or CI keychain
export APPLE_KEYCHAIN_PROFILE="vraxis-notary"

# Or use Apple ID credentials supplied at runtime
export APPLE_ID="build@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="..."
export APPLE_TEAM_ID="TEAMID"
```

```bash
npx vraxis-desktop release \
  --sign "Developer ID Application: Example Company (TEAMID)" \
  --notarize
```

Never place Apple credentials in `vraxis.desktop.config.mjs`. We have not tested this signing path with a Vraxis Apple Developer account yet.

## Prepare brand assets

Keep one master icon and export the files each platform expects:

| Asset | Recommended file | Used for |
|---|---|---|
| Master icon | 1024 x 1024 PNG with safe padding | Platform exports |
| macOS icon | `.icns` with the full icon set | App bundle, Dock, and Finder |
| Windows icon | Multi-size `.ico` | Executable and future installer |
| Linux icon | 512 x 512 or 1024 x 1024 PNG | Desktop entries and packages |
| Logo | SVG plus a transparent PNG fallback | About, loading, and release pages |

Check the icon at 16, 32, 64, 128, 256, 512, and 1024 pixels. Avoid text, thin details, screenshots, and artwork that touches the edge.

Vraxis Desktop validates asset paths and platform file types. It does not convert icons because generated assets still need visual review.

## Security defaults

The generated shell starts with these rules:

- The shell blocks Node.js integration for web content.
- Context isolation, renderer sandboxing, and web security stay enabled.
- Remote sources must use HTTPS.
- Local services must use loopback URLs.
- Authenticated local services receive a new token for each launch.
- The shell blocks new windows.
- The shell blocks cross-origin navigation unless you allow the origin.
- External links open in the browser only when requested.
- The shell blocks browser permissions unless you list them.

These rules follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Current release scope

Vraxis Desktop supports local development, bundled Node services, packaged smoke tests, unsigned app bundles, macOS disk images, checksums, and release manifests.

GitHub Actions runs the full desktop and Vraxis Read checks on macOS, Windows, and Ubuntu. It packs both candidates, installs them in a clean temporary project, launches the app, checks the authenticated service, and verifies the directory-picker bridge.

These items still need release work:

- Automatic update delivery
- OS registration for configured file associations
- Signed and notarized Vraxis releases tested with Apple credentials

The config accepts update and file-association metadata now. Metadata alone does not register file associations or deliver updates.

## How it differs

[Electron Forge](https://www.electronforge.io/) covers Electron packaging, makers, signing, and publishing. Vraxis Desktop uses a focused config for apps you own. It also supports local services.

[Pake](https://github.com/tw93/Pake) wraps a web page with Tauri from one command. Vraxis Desktop also handles static builds and apps that start a local service.

[Nativefier](https://github.com/nativefier/nativefier) helped establish the Electron URL-wrapper category. Its repository is now archived.

Vraxis Desktop serves the Vraxis product family. The package does not require another Vraxis tool.
