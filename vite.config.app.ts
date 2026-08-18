import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone Vite entrypoint (index.html -> src/standalone.tsx) used for local
// development and for embedding the Team page as a static page.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-standalone",
    target: "es2022",
  },
});
