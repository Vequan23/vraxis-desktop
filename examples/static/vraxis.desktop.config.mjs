import { defineDesktopApp } from "../../dist/index.js";

export default defineDesktopApp({
  schemaVersion: 1,
  app: {
    id: "vraxis-desktop-example",
    name: "Vraxis Desktop Example",
    version: "0.1.0",
    bundleId: "io.vraxis.desktop-example",
  },
  source: { kind: "static", directory: "site" },
  branding: { backgroundColor: "#202529" },
  window: { width: 900, height: 640 },
  security: { externalLinks: "browser" },
  packaging: { outputDirectory: "out", asar: true },
});
