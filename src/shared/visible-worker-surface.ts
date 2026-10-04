export const VISIBLE_WORKER_SURFACES = [
  "foreground_tab",
  "background_tab",
  "popup_window",
  "minimized_popup",
] as const;

export type VisibleWorkerSurface =
  (typeof VISIBLE_WORKER_SURFACES)[number];

export const PRODUCTION_EXECUTION_SURFACE = "popup_window" as const;
export const FOREGROUND_FALLBACK_SURFACE = "foreground_tab" as const;

export type WorkerPopupIssue =
  | "popup_closed"
  | "gemini_tab_closed"
  | "popup_minimized"
  | "popup_not_normal"
  | "popup_invalid"
  | "source_window_unavailable";

export function isVisibleWorkerSurface(
  value: unknown,
): value is VisibleWorkerSurface {
  return (
    typeof value === "string" &&
    (VISIBLE_WORKER_SURFACES as readonly string[]).includes(value)
  );
}
