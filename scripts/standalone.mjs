#!/usr/bin/env node
// Launcher for the standalone page: `node scripts/standalone.mjs dev|build`.
//
// Vite's own CLI validates its option list and exits on anything it does not
// recognise, so `--seat` cannot ride along with it. This drives Vite's JS API
// instead and leaves the flags themselves to vite.config.app.ts, which reads
// the same argv.
//
// Flags: --seat <key>  --hub <url>  (and --host/--port for dev)
import { build, createServer } from "vite";

const CONFIG_FILE = "vite.config.app.ts";

function flag(name) {
  const argv = process.argv;
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const command = process.argv[2];

if (command === "build") {
  await build({ configFile: CONFIG_FILE });
} else if (command === "dev") {
  const host = flag("host");
  const port = flag("port");
  const server = await createServer({
    configFile: CONFIG_FILE,
    server: {
      // `--host` with no value means every interface, which is what Vite's own
      // CLI does with the bare flag.
      ...(host === undefined ? {} : { host: host === "" ? true : host }),
      ...(port ? { port: Number(port) } : {}),
    },
  });
  await server.listen();
  server.printUrls();
} else {
  console.error("usage: node scripts/standalone.mjs dev|build [--seat <seat-key>] [--hub <url>]");
  process.exit(2);
}
