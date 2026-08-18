import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Library build: every bare specifier stays external so consumers dedupe React,
// mermaid, and the Markdown stack against their own tree.
function is_external(id: string): boolean {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0");
}

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: is_external,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
