import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const rendererRoot = resolve(__dirname, "src/renderer");

export default defineConfig({
  root: rendererRoot,
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, "src")]
    }
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        settings: resolve(rendererRoot, "settings/index.html"),
        overlay: resolve(rendererRoot, "overlay/index.html")
      }
    }
  }
});
