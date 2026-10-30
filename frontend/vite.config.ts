import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const frontendRoot = fileURLToPath(new URL("./", import.meta.url));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  envDir: projectRoot,
  cacheDir: fileURLToPath(new URL("../.cache/vite", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../build/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8000" } },
  preview: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8000" } },
});
