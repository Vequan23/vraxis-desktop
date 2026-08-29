import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startService } from "../src/runtime/service.js";

describe("local service hosting", () => {
  it("selects a port, waits for health, and stops the owned service", async () => {
    const script = `const http=require('http');const port=Number(process.env.PORT);http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')}).listen(port,'127.0.0.1')`;
    const service = await startService({
      kind: "service",
      command: process.execPath,
      args: ["-e", script],
      url: "http://127.0.0.1:{port}/app",
      healthcheck: "http://127.0.0.1:{port}/health",
      readyTimeoutMs: 5_000,
    });
    expect((await fetch(service.healthcheck)).ok).toBe(true);
    await service.stop();
    await expect(fetch(service.healthcheck)).rejects.toThrow();
  });

  it("runs a bundled Node service from its resource directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-service-bundle-"));
    const bundle = join(root, "service");
    await mkdir(bundle);
    await writeFile(join(bundle, "server.mjs"), `import{createServer}from'node:http';const port=Number(process.env.PORT);createServer((request,response)=>{response.writeHead(200);response.end('ready')}).listen(port,'127.0.0.1')`);
    const service = await startService({
      kind: "service",
      bundle: { directory: "service", entry: "server.mjs" },
      url: "http://127.0.0.1:{port}",
      readyTimeoutMs: 5_000,
    }, { baseDirectory: root, executable: process.execPath });
    expect(await (await fetch(service.url)).text()).toBe("ready");
    await service.stop();
  });

  it("passes only safe and explicitly inherited environment variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "vraxis-desktop-service-env-"));
    const bundle = join(root, "service");
    await mkdir(bundle);
    await writeFile(join(bundle, "server.mjs"), `import{createServer}from'node:http';const port=Number(process.env.PORT);createServer((request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({allowed:process.env.VRAXIS_TEST_ALLOWED||null,blocked:process.env.VRAXIS_TEST_BLOCKED||null}))}).listen(port,'127.0.0.1')`);
    process.env.VRAXIS_TEST_ALLOWED = "visible";
    process.env.VRAXIS_TEST_BLOCKED = "secret";
    try {
      const service = await startService({
        kind: "service",
        bundle: { directory: "service", entry: "server.mjs" },
        url: "http://127.0.0.1:{port}",
        environment: { inherit: ["VRAXIS_TEST_ALLOWED"] },
        readyTimeoutMs: 5_000,
      }, { baseDirectory: root, executable: process.execPath });
      expect(await (await fetch(service.url)).json()).toEqual({ allowed: "visible", blocked: null });
      await service.stop();
    } finally {
      delete process.env.VRAXIS_TEST_ALLOWED;
      delete process.env.VRAXIS_TEST_BLOCKED;
    }
  });

  it("gives authenticated services a per-launch token", async () => {
    const script = `const http=require('http');const port=Number(process.env.PORT);const token=process.env.VRAXIS_DESKTOP_TOKEN;http.createServer((request,response)=>{if(request.headers.authorization!=='Bearer '+token){response.writeHead(401);return response.end('denied')}response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({tokenLength:token.length}))}).listen(port,'127.0.0.1')`;
    const service = await startService({
      kind: "service",
      authentication: "desktop-token",
      command: process.execPath,
      args: ["-e", script],
      url: "http://127.0.0.1:{port}/app",
      healthcheck: "http://127.0.0.1:{port}/health",
      readyTimeoutMs: 5_000,
    });
    const token = new URL(service.url).searchParams.get("vraxis_token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect((await fetch(service.healthcheck)).status).toBe(401);
    expect(await (await fetch(service.healthcheck, { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({ tokenLength: token!.length });
    await service.stop();
  });
});
