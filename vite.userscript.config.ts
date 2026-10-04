import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const metadata = `// ==UserScript==
// @name         Gemini Search Bridge
// @namespace    https://github.com/H4M4CHi-ttr/gemini-in-search
// @version      0.3.0
// @description  Google検索にGeminiの途中回答を表示。通常ウィンドウと実験的PiP補助表示を選択できます。
// @match        https://www.google.com/search*
// @match        https://www.google.co.jp/search*
// @match        https://gemini.google.com/app*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        window.focus
// @license      MIT
// ==/UserScript==`;

export default defineConfig({
  plugins: [{
    name: "userscript-installation-guide",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "USERSCRIPT_README.md",
        source: readFileSync(new URL("./docs/USERSCRIPT.md", import.meta.url), "utf8"),
      });
    },
  }],
  build: {
    target: "es2022",
    outDir: "outputs/userscript",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/userscript/main.ts", import.meta.url)),
      name: "GeminiSearchBridgeUserscript",
      formats: ["iife"],
      fileName: () => "gemini-search-bridge.user.js",
    },
    rollupOptions: { output: { banner: metadata } },
  },
});
