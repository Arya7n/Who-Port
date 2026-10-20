import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The API allows a missing Origin and requires Host to be its own port.
// changeOrigin rewrites Host; the proxy also drops Origin.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: false,
    assetsDir: "assets",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4747",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
          });
        },
      },
    },
  },
});
