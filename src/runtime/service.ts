import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { ServiceSource } from "../types.js";

export interface RunningService {
  child: ChildProcess;
  url: string;
  healthcheck: string;
  stop: () => Promise<void>;
}

export interface ServiceRuntimeOptions {
  baseDirectory?: string;
  executable?: string;
  electronRunAsNode?: boolean;
}

export function serviceEnvironment(
  source: ServiceSource,
  port: number,
  ambient: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const replacePort = (value: string) => value.replaceAll("{port}", String(port));
  const environment: NodeJS.ProcessEnv = {};
  for (const name of safeEnvironmentNames) if (ambient[name] !== undefined) environment[name] = ambient[name];
  if (process.platform !== "win32" && environment.HOME) {
    const entries = (environment.PATH ?? "").split(delimiter).filter(Boolean);
    const userBin = join(environment.HOME, ".local", "bin");
    environment.PATH = [...new Set([...entries, userBin])].join(delimiter);
  }
  for (const name of source.environment?.inherit ?? []) if (ambient[name] !== undefined) environment[name] = ambient[name];
  for (const [name, value] of Object.entries(source.environment?.set ?? {})) environment[name] = replacePort(value);
  environment[source.portEnvironment ?? "PORT"] = String(port);
  return environment;
}

export async function startService(source: ServiceSource, options: ServiceRuntimeOptions = {}): Promise<RunningService> {
  const port = source.port || await openPort();
  const replacePort = (value: string) => value.replaceAll("{port}", String(port));
  const environment = serviceEnvironment(source, port);
  const accessToken = source.authentication === "desktop-token" ? randomBytes(32).toString("base64url") : "";
  if (accessToken) environment.VRAXIS_DESKTOP_TOKEN = accessToken;
  let command: string;
  let args = (source.args ?? []).map(replacePort);
  let workingDirectory: string | undefined;
  if (source.bundle) {
    const bundleRoot = isAbsolute(source.bundle.directory) ? source.bundle.directory : resolve(options.baseDirectory ?? process.cwd(), source.bundle.directory);
    command = options.executable ?? process.execPath;
    args = [resolve(bundleRoot, source.bundle.entry), ...args];
    workingDirectory = bundleRoot;
    if (options.electronRunAsNode) environment.ELECTRON_RUN_AS_NODE = "1";
  } else command = replacePort(source.command!);
  const child = spawn(command, args, {
    ...(workingDirectory ? { cwd: workingDirectory } : {}),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let launchError: Error | null = null;
  child.once("error", error => { launchError = error; });
  child.stdout?.on("data", chunk => process.stdout.write(`[desktop:service] ${chunk}`));
  child.stderr?.on("data", chunk => process.stderr.write(`[desktop:service] ${chunk}`));
  const url = accessToken ? addBootstrapToken(replacePort(source.url), accessToken) : replacePort(source.url);
  const healthcheck = replacePort(source.healthcheck ?? source.url);
  try {
    await waitUntilReady(healthcheck, child, source.readyTimeoutMs ?? 30_000, () => launchError, accessToken);
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
  return { child, url, healthcheck, stop: () => stopChild(child) };
}

const safeEnvironmentNames = [
  "APPDATA", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "LOGNAME", "PATH", "PATHEXT", "SHELL",
  "SystemRoot", "TEMP", "TMP", "TMPDIR", "USER", "USERPROFILE", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
] as const;

export async function waitUntilReady(url: string, child: ChildProcess, timeout: number, launchError: () => Error | null = () => null, accessToken = ""): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const error = launchError();
    if (error) throw new Error(`The local service could not start: ${error.message}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The local service stopped before ${url} was ready.`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(750),
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });
      if (response.ok) return;
    } catch { /* service is still starting */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`The local service did not become ready at ${url}.`);
}

function addBootstrapToken(value: string, token: string): string {
  const url = new URL(value);
  url.searchParams.set("vraxis_token", token);
  return url.href;
}

async function openPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>(resolveExit => child.once("exit", () => resolveExit())),
    new Promise<void>(resolveDelay => setTimeout(resolveDelay, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
