#!/usr/bin/env node

const { runCli } = await import("../dist/cli.js");

process.exitCode = await runCli().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
});
