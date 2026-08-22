// jsdom does not give you a browser; it gives you a *second realm* whose
// intrinsics are installed over the worker's own. Two consequences are
// load-bearing here, and both used to surface as errors naming something
// other than their cause.
//
// 1. THE BINARY CONSTRUCTORS COME FROM THE WRONG REALM.
//    `new TextEncoder().encode("") instanceof Uint8Array` is FALSE under
//    jsdom. Measured, the mismatch is not where it looks: jsdom's
//    TextEncoder *is* Node's — same constructor identity — so every producer
//    of binary data in the worker (node:util, node:crypto, esbuild) emits
//    Node-realm objects. What is foreign is the global `Uint8Array` itself,
//    which vitest's jsdom environment overwrites with `window.Uint8Array`
//    from the vm context. The consumer is the odd one out, not the producer.
//    esbuild asserts that exact invariant at require() time, so any test
//    transitively loading it — importing vite.config.app.ts is enough — died
//    with "your JavaScript environment is broken" and no mention of jsdom.
//
// 2. `crypto.subtle` IS UNDEFINED.
//    jsdom installs a `crypto` global with getRandomValues and no
//    SubtleCrypto, shadowing Node's webcrypto. hub_ledger's sha256_hex read
//    that as "Cannot read properties of undefined (reading 'digest')" raised
//    from inside turn_hash, which reads as a ledger bug and is not one.
//
// Neither is a polyfill for a missing platform feature. Both undo a
// substitution the environment made, restoring the realm the rest of the
// worker already lives in.
import { webcrypto } from "node:crypto";
import { URL as NodeURL, URLSearchParams as NodeURLSearchParams, fileURLToPath } from "node:url";
import { TextEncoder as NodeTextEncoder } from "node:util";

// The Node realm is not reachable by name here — inside this module
// `Uint8Array` already resolves to whatever jsdom installed. It is reachable
// only through an object a node:* module MADE ITSELF, so derive it from one.
// It has to be a fresh allocation: webcrypto.getRandomValues looks like a
// source of Node-realm bytes and is not — it fills and returns the very array
// you hand it, so deriving from it just hands jsdom's constructor back.
const NODE_BYTES = new NodeTextEncoder().encode("");
const NODE_UINT8ARRAY = Object.getPrototypeOf(NODE_BYTES).constructor;
const NODE_ARRAYBUFFER = Object.getPrototypeOf(NODE_BYTES.buffer).constructor;

Object.defineProperty(globalThis, "Uint8Array", {
  value: NODE_UINT8ARRAY,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "ArrayBuffer", {
  value: NODE_ARRAYBUFFER,
  configurable: true,
  writable: true,
});

// Same species, third instance: jsdom's `URL` is its own, and Node's path
// layer type-checks by identity. `fileURLToPath(new URL(...))` — how vite's
// own constants.js resolves its paths, reached by importing
// vite.config.app.ts — rejects a jsdom URL with "must be of type string or an
// instance of Buffer or URL. Received an instance of URL", which is a true
// sentence and a useless one.
Object.defineProperty(globalThis, "URL", {
  value: NodeURL,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "URLSearchParams", {
  value: NodeURLSearchParams,
  configurable: true,
  writable: true,
});

if (!globalThis.crypto?.subtle) {
  // `crypto` is a getter-only own property of the jsdom window, so plain
  // assignment is silently ignored; defineProperty is the only way through.
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// The point of this file is these invariants. Assert them rather than trusting
// that the writes above did what they read like — if a future jsdom or vitest
// changes the shape again, the suite must fail HERE, naming the environment,
// instead of resurfacing as an esbuild panic or a null dereference three
// layers into application code.
const PROBE = new TextEncoder().encode("");
if (!(PROBE instanceof Uint8Array)) {
  throw new Error(
    "tests/setup/jsdom_globals.ts: TextEncoder output still fails an identity " +
      "check against the global Uint8Array. esbuild and anything else doing " +
      "instanceof on typed arrays will fail with a misleading message.",
  );
}
if (!(PROBE.buffer instanceof ArrayBuffer)) {
  throw new Error(
    "tests/setup/jsdom_globals.ts: the global ArrayBuffer is still a foreign " +
      "realm's. Any instanceof check on a buffer produced by node:* will be " +
      "wrong.",
  );
}
// Assert the URL fix through the operation that actually broke, not through
// an identity check that could pass while the thing it stands for fails.
try {
  fileURLToPath(new URL("file:///probe"));
} catch (cause) {
  throw new Error(
    "tests/setup/jsdom_globals.ts: the global URL is still a foreign realm's — " +
      "node:path rejects it. Importing any vite config from a test will fail.",
    { cause },
  );
}
if (typeof globalThis.crypto?.subtle?.digest !== "function") {
  throw new Error(
    "tests/setup/jsdom_globals.ts: crypto.subtle.digest is still missing after " +
      "patching. Anything hashing (hub_ledger.sha256_hex) will fail with a " +
      "null dereference that names the caller, not the environment.",
  );
}
