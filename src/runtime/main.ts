import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedDesktopConfig } from "../types.js";
import { loadDesktopConfig } from "../config.js";
import { validateDesktopConfig } from "../validate.js";
import { startService, type RunningService } from "./service.js";
import { chooseDirectory, directoryPickerChannel } from "./native-bridge.js";

protocol.registerSchemesAsPrivileged([{ scheme: "vraxis-app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let mainWindow: BrowserWindow | null = null;
let runningService: RunningService | null = null;
let activeConfig: ResolvedDesktopConfig | null = null;
let nativeBridgeRegistered = false;

async function loadPackagedConfig(): Promise<ResolvedDesktopConfig> {
  const developmentPath = process.env.VRAXIS_DESKTOP_CONFIG;
  const path = developmentPath || resolve(app.getAppPath(), "desktop.config.json");
  if (!developmentPath) {
    const value = JSON.parse(await readFile(path, "utf8")) as ResolvedDesktopConfig;
    const errors = validateDesktopConfig(value);
    if (errors.length) throw new Error(errors.map(issue => `${issue.path}: ${issue.message}`).join(" "));
    return { ...value, configPath: path, projectDirectory: app.getAppPath() };
  }
  const inspection = await loadDesktopConfig(path);
  if (!inspection.valid || !inspection.config) {
    const message = inspection.errors.map(issue => `${issue.path}: ${issue.message}`).join(" ");
    throw new Error(message || "The desktop config could not be loaded.");
  }
  return inspection.config;
}

async function createWindow(config: ResolvedDesktopConfig): Promise<void> {
  activeConfig = config;
  registerNativeBridge();
  const source = config.source;
  let target: string;
  if (source.kind === "service") {
    runningService = await startService(source, {
      baseDirectory: app.isPackaged ? process.resourcesPath : config.projectDirectory,
      executable: process.execPath,
      electronRunAsNode: Boolean(process.versions.electron),
    });
    target = runningService.url;
  } else if (source.kind === "remote") target = source.url;
  else {
    const root = resolve(config.projectDirectory, source.directory);
    await registerStaticProtocol(root, source.index ?? "index.html");
    target = `vraxis-app://bundle/${source.index ?? "index.html"}`;
  }

  const allowedOrigins = new Set([new URL(target).origin, ...(config.security?.allowedNavigationOrigins ?? [])]);
  const allowedPermissions = new Set(config.security?.permissions ?? []);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowedPermissions.has(permission as never)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowedPermissions.has(permission as never));

  mainWindow = new BrowserWindow({
    title: config.app.name,
    width: config.window?.width ?? 1200,
    height: config.window?.height ?? 800,
    minWidth: config.window?.minWidth ?? 720,
    minHeight: config.window?.minHeight ?? 480,
    resizable: config.window?.resizable ?? true,
    fullscreen: config.window?.fullscreen ?? false,
    titleBarStyle: config.window?.titleBarStyle ?? "default",
    backgroundColor: config.branding?.backgroundColor ?? "#1f2428",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      ...(config.integrations?.directoryPicker ? {
        preload: resolve(dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
        additionalArguments: ["--vraxis-directory-picker"],
      } : {}),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    handleExternal(url, config);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", event => {
    const destination = event.url;
    if (allowedOrigins.has(new URL(destination).origin)) return;
    event.preventDefault();
    handleExternal(destination, config);
  });
  await mainWindow.loadURL(target);
  if (process.env.VRAXIS_DESKTOP_SMOKE === "1") {
    const title = await mainWindow.webContents.executeJavaScript("document.title", true) as string;
    let serviceHealthy = true;
    if (runningService) {
      const healthcheck = new URL(runningService.healthcheck);
      const browserHealthcheck = `${healthcheck.pathname}${healthcheck.search}`;
      serviceHealthy = await mainWindow.webContents.executeJavaScript(
        `fetch(${JSON.stringify(browserHealthcheck)}, { credentials: "same-origin" }).then(response => response.ok).catch(() => false)`,
        true,
      ) as boolean;
      if (!serviceHealthy) throw new Error("The desktop window could not reach the bundled service.");
    }
    const directoryPickerReady = !config.integrations?.directoryPicker || await mainWindow.webContents.executeJavaScript(
      "typeof window.vraxisDesktop?.chooseDirectory === 'function'",
      true,
    ) as boolean;
    if (!directoryPickerReady) throw new Error("The native directory picker bridge was not available to the desktop window.");
    console.log(`[desktop:smoke] ${JSON.stringify({ title, url: mainWindow.webContents.getURL(), serviceHealthy, directoryPickerReady })}`);
    app.quit();
  }
}

function registerNativeBridge(): void {
  if (nativeBridgeRegistered) return;
  nativeBridgeRegistered = true;
  ipcMain.handle(directoryPickerChannel, async event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Vraxis Desktop rejected this directory request.");
    const config = activeConfig;
    if (!config?.integrations?.directoryPicker || config.source.kind === "remote") throw new Error("This app cannot open the native directory picker.");
    return chooseDirectory(config.integrations.directoryPicker, options => dialog.showOpenDialog(mainWindow!, options));
  });
}

function handleExternal(value: string, config: ResolvedDesktopConfig): void {
  if (config.security?.externalLinks !== "browser") return;
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol)) void shell.openExternal(url.href);
  } catch { /* ignore invalid navigation */ }
}

async function registerStaticProtocol(root: string, index: string): Promise<void> {
  protocol.handle("vraxis-app", async request => {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname === "/" ? `/${index}` : url.pathname);
    const file = resolve(root, `.${requested}`);
    if (relative(root, file).startsWith("..")) return new Response("Not found", { status: 404 });
    try {
      const content = await readFile(file);
      return new Response(new Uint8Array(content), { headers: { "content-type": contentType(file) } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function showStartupError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  mainWindow = new BrowserWindow({ width: 720, height: 420, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const html = `<meta charset="utf-8"><style>body{font:16px system-ui;background:#202529;color:#eef;padding:48px;line-height:1.5}h1{font-size:24px}p{color:#b8c0c7}</style><h1>This app could not start</h1><p>${escapeHtml(message)}</p><p>Check the desktop config and try again.</p>`;
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    try { await createWindow(await loadPackagedConfig()); }
    catch (error) { await showStartupError(error); }
  });
  app.on("before-quit", () => { if (runningService) void runningService.stop(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) void loadPackagedConfig().then(createWindow).catch(showStartupError); });
}
