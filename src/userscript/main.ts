import { readGoogleQuery } from "../content/google/query-observer";
import { isWorkerId } from "./protocol";
import { startGoogle } from "./google-flow";
import { startGemini } from "./worker";
import { openPreferences } from "./preferences-view";
import { localized } from "./i18n";

const marker = /^#gsb-worker=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
if (window.top === window) {
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(localized("Gemini Search Bridge 設定", "Gemini Search Bridge settings"), openPreferences);
  }
  GM_getTab((tab) => {
    const workerId = isWorkerId(marker) ? marker : tab.gsbWorkerId;
    if (location.hostname === "gemini.google.com" && isWorkerId(workerId)) {
      void startGemini(tab, workerId);
    } else if (readGoogleQuery()) {
      void startGoogle(tab);
    }
  });
}
