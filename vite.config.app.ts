import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone Vite entrypoint (index.html -> src/standalone.tsx) used for local
// development and for embedding the Team page as a static page.
//
// `--seat` opens the page's session on load, for surfaces where the connection
// card cannot receive a key: an embedded browser denies both the paste
// shortcut and the file dialog.
//
//   node scripts/standalone.mjs dev   --seat agora_… --hub http://127.0.0.1:8760
//   node scripts/standalone.mjs build --seat agora_… --hub http://127.0.0.1:8760
//
// It takes the seat KEY, never a seat name. Resolving a name would mean this
// config reading `~/.agora/keys.json` and authenticating as a seat nobody
// named on that command line — an ambient credential, which is the thing a
// flag is supposed to replace. Whoever starts the page supplies the secret,
// every time, in the open. Nothing here is read from the environment either.
//
// `--hub` on the DEV SERVER also carries the Hub on the dev origin, at /hub.
// A browser refuses a cross-origin call to a Hub that has not allowed that
// origin, and the refusal happens before the request is sent, so the page
// can only report "Failed to fetch" about a Hub that never heard from it.
// Vite forwarding /hub server-side makes the call same-origin, which needs
// nothing from the Hub and reaches one the browser could not route to at all
// — a Hub on a container's loopback, say. It is the dev server's own relay:
// `npm run build:standalone` produces no such thing, and a built page calls
// the absolute `--hub` URL directly, which is the deployment the package
// documents and which does need the Hub's opt-in CORS.

const PROXY_PREFIX = "/hub";

function flag(name: string): string {
  const argv = process.argv;
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return "";
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

export default defineConfig(({ command }) => {
  const seat_key = flag("seat").trim();
  const hub_url = flag("hub").trim().replace(/\/+$/, "");
  // An absolute Hub is the one a dev server can carry; a relative `--hub` is
  // already same-origin and is passed through untouched.
  const proxied = command === "serve" && /^https?:\/\//i.test(hub_url);
  const page_hub_url = proxied ? PROXY_PREFIX : hub_url;

  if (command === "build" && seat_key) {
    console.warn(
      "\n  ⚠  --seat on a build writes that seat key in cleartext into dist-standalone/assets/." +
      "\n     Every visitor of the served page acts as that seat: do not publish or copy" +
      "\n     this artifact, and rotate the key if it escapes.\n",
    );
  }

  if (proxied) {
    console.info(`\n  ${PROXY_PREFIX} → ${hub_url} (dev server; the page calls its own origin, so the Hub needs no CORS)\n`);
  }

  return {
    plugins: [react()],
    define: {
      __AGORA_PRESET_SEAT_KEY__: JSON.stringify(seat_key),
      __AGORA_PRESET_HUB_URL__: JSON.stringify(page_hub_url),
    },
    server: proxied ? {
      proxy: {
        [PROXY_PREFIX]: {
          target: hub_url,
          changeOrigin: true,
          // The Hub's browser lane is /ws?token=KEY, and a relative base
          // resolves the socket against the page origin, so it arrives here.
          ws: true,
          rewrite: (path: string) => path.slice(PROXY_PREFIX.length) || "/",
        },
      },
    } : {},
    build: {
      outDir: "dist-standalone",
      target: "es2022",
    },
  };
});
