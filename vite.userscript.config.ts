import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const metadata = `// ==UserScript==
// @name         Gemini Search Bridge
// @namespace    https://github.com/H4M4CHi-ttr/gemini-in-search
// @version      0.5.0
// @description  Show Gemini Web answers in Google Search with a visible PiP companion.
// @description:ja PiP小窓を使ってGoogle検索にGeminiの途中回答を表示します。
// @homepageURL  https://github.com/H4M4CHi-ttr/gemini-in-search-userscript
// @supportURL   https://github.com/H4M4CHi-ttr/gemini-in-search-userscript/issues
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
// @grant        GM_registerMenuCommand
// @grant        window.focus
// @license      MIT
// ==/UserScript==`;

export default defineConfig({
  plugins: [{
    name: "userscript-installation-guide",
    generateBundle() {
      for (const [fileName, sourceName] of [
        ["USERSCRIPT_README.md", "USERSCRIPT.md"],
        ["DESIGN.md", "DESIGN.md"],
      ]) {
        this.emitFile({ type: "asset", fileName: fileName!,
          source: readFileSync(new URL(`./docs/${sourceName}`, import.meta.url), "utf8") });
      }
    },
    writeBundle() {
      // Keep the local path and publish one readable installer built from the same sources.
      const directory = new URL("./dist/", import.meta.url);
      mkdirSync(directory, { recursive: true });
      copyFileSync(new URL("./outputs/userscript/gemini-search-bridge.user.js", import.meta.url),
        new URL("gemini-in-search.user.js", directory));
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
