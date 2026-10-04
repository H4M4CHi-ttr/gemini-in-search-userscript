import { readGoogleQuery } from "../content/google/query-observer";
import { isWorkerId } from "./protocol";
import { startGoogle } from "./google-flow";
import { startGemini } from "./worker";

const marker = /^#gsb-worker=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
if (window.top === window) {
  GM_getTab((tab) => {
    const workerId = isWorkerId(marker) ? marker : tab.gsbWorkerId;
    if (location.hostname === "gemini.google.com" && isWorkerId(workerId)) {
      void startGemini(tab, workerId);
    } else if (readGoogleQuery()) {
      void startGoogle(tab);
    }
  });
}
