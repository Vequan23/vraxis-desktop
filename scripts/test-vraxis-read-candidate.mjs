import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readerDirectory = resolve(process.argv[2] || join(desktopDirectory, "..", "vraxis-read"));
const temporary = await mkdtemp(join(tmpdir(), "vraxis-read-desktop-smoke-"));
const serviceDirectory = join(temporary, "service");
const consumerDirectory = join(temporary, "consumer");
const dataDirectory = join(temporary, "data");
const npmCli = process.env.npm_execpath;

try {
  await Promise.all([mkdir(serviceDirectory), mkdir(consumerDirectory), mkdir(dataDirectory)]);
  await runNpm(["pack", "--pack-destination", temporary], desktopDirectory);
  await runNpm(["pack", "--pack-destination", temporary], readerDirectory);
  const archives = await readdir(temporary);
  const desktopArchive = join(temporary, requiredArchive(archives, "vraxis-desktop-"));
  const readerArchive = join(temporary, requiredArchive(archives, "vraxis-reader-"));

  await writeJson(join(serviceDirectory, "package.json"), { name: "vraxis-read-smoke-service", private: true, type: "module" });
  await runNpm(["install", "--omit=dev", "--no-audit", "--no-fund", readerArchive], serviceDirectory);

  await writeJson(join(consumerDirectory, "package.json"), { name: "vraxis-read-smoke-consumer", private: true, type: "module" });
  await runNpm(["install", "--no-audit", "--no-fund", desktopArchive], consumerDirectory);
  await writeFile(join(consumerDirectory, "vraxis.desktop.config.mjs"), `export default ${JSON.stringify({
    schemaVersion: 1,
    app: { id: "vraxis-read-smoke", name: "Vraxis Read Smoke", author: "Vraxis", version: "0.0.0", bundleId: "io.vraxis.read-smoke" },
    source: {
      kind: "service",
      authentication: "desktop-token",
      bundle: { directory: serviceDirectory, entry: "node_modules/@vraxis/reader/dist-server/server/index.js" },
      url: "http://127.0.0.1:{port}/app",
      healthcheck: "http://127.0.0.1:{port}/api/health",
      environment: { set: { VRAXIS_READ_DATA_DIR: dataDirectory } },
    },
    integrations: { directoryPicker: { title: "Choose a folder for Vraxis Read", buttonLabel: "Observe folder" } },
    packaging: { outputDirectory: "out", asar: true },
  }, null, 2)};\n`, "utf8");

  const cli = join(consumerDirectory, "node_modules", "@vraxis", "desktop", "dist", "cli.js");
  if (process.platform === "linux") await run("xvfb-run", ["-a", process.execPath, cli, "test-package"], consumerDirectory);
  else await run(process.execPath, [cli, "test-package"], consumerDirectory);
  console.log(`Verified the exact Vraxis Desktop and Vraxis Read candidates on ${process.platform} ${process.arch}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function requiredArchive(files, prefix) {
  const archive = files.find(file => file.startsWith(prefix) && file.endsWith(".tgz"));
  if (!archive) throw new Error(`npm pack did not create ${prefix}*.tgz.`);
  return archive;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

function runNpm(args, cwd) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], cwd);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, cwd);
}
