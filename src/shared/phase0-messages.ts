import type { FrameRuleScope } from "../background/dnr-manager";
import type { QueryJob } from "./query-models";

export type LoginState = "logged_in" | "logged_out" | "unknown";
export type DetectionStage = "connected" | "document_ready" | "surface";
export type OffscreenVisibilityState = "hidden" | "visible";

export interface GeminiFrameReport {
  type: "GEMINI_FRAME_REPORT";
  panelInstanceId: string;
  frameInstanceId: string;
  stage: DetectionStage;
  parentVerified: true;
  loginState: LoginState;
  inputSelector: string | null;
  sendButtonSelector: string | null;
  blockingKind: "captcha" | "rate_limit" | null;
  blockingSelector: string | null;
}

export interface Phase0DebugSnapshot {
  type: "PHASE0_DEBUG_SNAPSHOT";
  offscreenConnected: boolean;
  offscreenDocument: {
    contextId: string;
    documentUrl: string;
    visibilityState: OffscreenVisibilityState;
  } | null;
  framePolicy: {
    scope: FrameRuleScope;
    preflight: RuleMatchState;
  } | null;
  dnrMatched: boolean;
  dnrRequest: {
    initiator: string | null;
    tabId: number;
    frameId: number;
    parentFrameId: number;
    topLevelDomain: string;
    topLevelDocumentUrl: string;
  } | null;
  iframeLoadObserved: boolean;
  lastCleanup: {
    reason:
      | "job_completed"
      | "job_failed"
      | "offscreen_closed"
      | "idle_timeout"
      | "iframe_failed"
      | "cleanup";
    verifiedAbsent: true;
  } | null;
  idleCloseScheduled: boolean;
  frameReport: GeminiFrameReport | null;
  phase06: {
    frameBootCount: number;
    activeFrameInstanceId: string | null;
    activeDocumentId: string | null;
    reloadExtractionAttempted: boolean;
    traceEventCount: number;
  };
  currentRuleInstalled: boolean;
  error: {
    stage: string;
    detail: string;
  } | null;
}

export interface Phase0DebugSnapshotRequest {
  type: "PHASE0_DEBUG_SNAPSHOT_REQUEST";
}

export interface GeminiFrameBootMessage {
  type: "GEMINI_FRAME_BOOT";
  panelInstanceId: string;
  frameInstanceId: string;
  href: string;
  timeOrigin: number;
  readyState: DocumentReadyState;
  visibilityState: DocumentVisibilityState;
  hasFocus: boolean;
  innerWidth: number;
  innerHeight: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
}

export interface GeminiFrameBootResponse {
  accepted: boolean;
  documentId: string | null;
  documentLifecycle: string | null;
  workerSessionId?: string;
  reattachRun?: import("./query-messages").RunQueryFrameMessage;
}

export type OffscreenToWorkerMessage =
  | {
      type: "OFFSCREEN_BOOT";
      contextId: string;
      documentUrl: string;
      visibilityState: OffscreenVisibilityState;
    }
  | {
      type: "OFFSCREEN_HEARTBEAT";
      contextId: string;
    }
  | {
      type: "OFFSCREEN_IFRAME_LOAD_OBSERVED";
      contextId: string;
    }
  | {
      type: "OFFSCREEN_ERROR";
      contextId: string;
      stage: "iframe_load" | "surface" | "runtime";
      detail: string;
    }
  | {
      type: "OFFSCREEN_IDLE_TIMEOUT";
      contextId: string;
    }
  | {
      type: "OFFSCREEN_RELOAD_REQUEST";
      contextId: string;
      jobId: string;
      href: string;
    };

export type WorkerToOffscreenMessage =
  | {
      type: "OFFSCREEN_FRAME_POLICY_READY";
      contextId: string;
      scope: FrameRuleScope;
      preflight: RuleMatchState;
    }
  | {
      type: "OFFSCREEN_SURFACE_READY";
      contextId: string;
    }
  | {
      type: "OFFSCREEN_BEGIN_IDLE";
      contextId: string;
      delayMs: number;
    }
  | {
      type: "OFFSCREEN_CANCEL_IDLE";
      contextId: string;
    }
  | {
      type: "RUN_QUERY_JOB";
      panelInstanceId: string;
      nonce: string;
      job: QueryJob;
    }
  | {
      type: "OFFSCREEN_CAPTURE_LAYOUT_SERIES";
      contextId: string;
      jobId: string;
    }
  | {
      type: "OFFSCREEN_JOB_SETTLED";
      contextId: string;
      jobId: string;
    }
  | {
      type: "OFFSCREEN_RELOAD_IFRAME";
      contextId: string;
      jobId: string;
      href: string;
    }
  | {
      type: "PHASE0_ERROR";
      stage: string;
      detail: string;
    };

export type RuleMatchState = "matched" | "not_matched" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPanelInstanceId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function isVisibilityState(value: unknown): value is OffscreenVisibilityState {
  return value === "hidden" || value === "visible";
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeFiniteNumber(
  value: unknown,
): value is number | null {
  return value === null || isNonNegativeFiniteNumber(value);
}

function isBoundedDetail(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 500;
}

export function isOffscreenToWorkerMessage(
  value: unknown,
): value is OffscreenToWorkerMessage {
  if (
    !isRecord(value) ||
    !isPanelInstanceId(value.contextId)
  ) {
    return false;
  }

  if (value.type === "OFFSCREEN_BOOT") {
    return (
      typeof value.documentUrl === "string" &&
      value.documentUrl.length >= 1 &&
      value.documentUrl.length <= 2_048 &&
      isVisibilityState(value.visibilityState)
    );
  }

  if (value.type === "OFFSCREEN_ERROR") {
    return (
      (value.stage === "iframe_load" ||
        value.stage === "surface" ||
        value.stage === "runtime") &&
      isBoundedDetail(value.detail)
    );
  }

  if (value.type === "OFFSCREEN_RELOAD_REQUEST") {
    return (
      typeof value.jobId === "string" &&
      value.jobId.length >= 1 &&
      value.jobId.length <= 128 &&
      typeof value.href === "string" &&
      value.href.startsWith("https://gemini.google.com/app") &&
      value.href.length <= 2_048
    );
  }

  return (
    value.type === "OFFSCREEN_HEARTBEAT" ||
    value.type === "OFFSCREEN_IFRAME_LOAD_OBSERVED" ||
    value.type === "OFFSCREEN_IDLE_TIMEOUT"
  );
}

export function isGeminiFrameBootMessage(
  value: unknown,
): value is GeminiFrameBootMessage {
  if (!isRecord(value) || value.type !== "GEMINI_FRAME_BOOT") {
    return false;
  }

  return (
    isPanelInstanceId(value.panelInstanceId) &&
    isPanelInstanceId(value.frameInstanceId) &&
    typeof value.href === "string" &&
    value.href.startsWith("https://gemini.google.com/") &&
    value.href.length <= 8_192 &&
    isNonNegativeFiniteNumber(value.timeOrigin) &&
    (value.readyState === "loading" ||
      value.readyState === "interactive" ||
      value.readyState === "complete") &&
    (value.visibilityState === "hidden" || value.visibilityState === "visible") &&
    typeof value.hasFocus === "boolean" &&
    isNonNegativeFiniteNumber(value.innerWidth) &&
    isNonNegativeFiniteNumber(value.innerHeight) &&
    isNullableNonNegativeFiniteNumber(value.visualViewportWidth) &&
    isNullableNonNegativeFiniteNumber(value.visualViewportHeight)
  );
}

export function isGeminiFrameReport(value: unknown): value is GeminiFrameReport {
  if (!isRecord(value) || value.type !== "GEMINI_FRAME_REPORT") {
    return false;
  }

  const validStage =
    value.stage === "connected" ||
    value.stage === "document_ready" ||
    value.stage === "surface";
  const validLogin =
    value.loginState === "logged_in" ||
    value.loginState === "logged_out" ||
    value.loginState === "unknown";
  const validSelector = (selector: unknown): boolean =>
    selector === null ||
    (typeof selector === "string" && selector.length <= 512);

  return (
    isPanelInstanceId(value.panelInstanceId) &&
    isPanelInstanceId(value.frameInstanceId) &&
    validStage &&
    value.parentVerified === true &&
    validLogin &&
    validSelector(value.inputSelector) &&
    validSelector(value.sendButtonSelector) &&
    (value.blockingKind === null ||
      value.blockingKind === "captcha" ||
      value.blockingKind === "rate_limit") &&
    validSelector(value.blockingSelector)
  );
}

export function isPhase0DebugSnapshotRequest(
  value: unknown,
): value is Phase0DebugSnapshotRequest {
  return isRecord(value) && value.type === "PHASE0_DEBUG_SNAPSHOT_REQUEST";
}
