import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { offlineDocument, offlineScript } from "./src/shared/offline.js";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "relay-offline-i18n",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "offline.html",
          source: offlineDocument,
        });
        this.emitFile({
          type: "asset",
          fileName: "offline-i18n.js",
          source: offlineScript,
        });
        const version = createHash("sha256")
          .update(offlineDocument + offlineScript)
          .digest("hex")
          .slice(0, 16);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: readFileSync("src/web/service-worker.js", "utf8").replace(
            "__OFFLINE_VERSION__",
            version,
          ),
        });
      },
    },
  ],
  build: {
    outDir: "dist/web",
    // 所有数学字体均以同源文件交付，符合应用的字体加载策略。
    assetsInlineLimit: (file) => /KaTeX_.*\.woff2?$/.test(file) ? false : undefined,
  },
  server: { proxy: { "/api": "http://127.0.0.1:3180" } },
});
