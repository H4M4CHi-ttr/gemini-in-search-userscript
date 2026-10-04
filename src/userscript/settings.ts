import { SETTINGS_KEY } from "./protocol";

// A new PiP-first consent is required; old autoRun/usePip settings are not reused.
export function consentAccepted(): boolean {
  const value = GM_getValue<unknown>(SETTINGS_KEY, null);
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).version === 4 &&
    (value as Record<string, unknown>).consentAccepted === true;
}

export function acceptConsent(): void {
  GM_setValue(SETTINGS_KEY, { version: 4, consentAccepted: true });
}

export function documentReady(): Promise<void> {
  return document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }))
    : Promise.resolve();
}
