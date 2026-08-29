import { defineDesktopApp } from "../../dist/index.js";

export default defineDesktopApp({
  schemaVersion: 1,
  app: {
    id: "vraxis-read",
    name: "Vraxis Read",
    author: "Vraxis",
    version: "0.4.4",
    description: "A local-first technical reader.",
    bundleId: "io.vraxis.read",
  },
  source: {
    kind: "service",
    authentication: "desktop-token",
    command: "vraxis-read",
    args: ["--no-open", "--port", "{port}"],
    url: "http://127.0.0.1:{port}/app",
    healthcheck: "http://127.0.0.1:{port}/api/health",
    readyTimeoutMs: 30_000,
  },
  window: { width: 1440, height: 940, minWidth: 980, minHeight: 680 },
  security: { externalLinks: "browser" },
  integrations: { directoryPicker: { title: "Choose a folder for Vraxis Read", buttonLabel: "Observe folder" } },
  packaging: { outputDirectory: "out", asar: true },
});
