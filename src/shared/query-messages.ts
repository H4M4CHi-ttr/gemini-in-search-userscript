import {
  MAX_MESSAGE_DETAIL_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_SOURCE_URL_LENGTH,
  isJobStatus,
  isPositiveTabId,
  type JobStatus,
  type QueryJob,
} from "./query-models";
import {
  isStructuredAnswer,
  type StructuredAnswer,
} from "./answer-models";
import type {
  VisibleWorkerSurface,
  WorkerPopupIssue,
} from "./visible-worker-surface";

export const MESSAGE_SOURCE = "gemini-search-bridge";

export interface GooglePageReadyMessage {
  type: "GOOGLE_PAGE_READY";
  query: string;
  url: string;
}

export interface StartQueryMessage {
  type: "START_QUERY";
  query: string;
  url: string;
}

export interface QueueQueryMessage {
  type: "QUEUE_QUERY";
  query: string;
  url: string;
  mode: "manual" | "auto";
}

export interface OpenGeminiTabFallbackMessage {
  type: "OPEN_GEMINI_TAB_FALLBACK";
  jobId: string;
}

export interface RecreateWorkerPopupMessage {
  type: "RECREATE_WORKER_POPUP";
  jobId: string;
}

export type GoogleToWorkerMessage =
  | GooglePageReadyMessage
  | StartQueryMessage
  | QueueQueryMessage
  | OpenGeminiTabFallbackMessage
  | RecreateWorkerPopupMessage;

export interface JobStatusMessage {
  type: "JOB_STATUS";
  jobId: string;
  status: JobStatus;
  detail?: string;
  surfaceIssue?: WorkerPopupIssue;
}

export interface GeminiStatusMessage {
  type: "GEMINI_STATUS";
  jobId: string;
  sourceTabId: number;
  panelInstanceId: string;
  frameInstanceId: string;
  nonce: string;
  status: JobStatus;
  detail?: string;
}

export interface RunQueryFrameMessage {
  source: typeof MESSAGE_SOURCE;
  type: "RUN_QUERY";
  panelInstanceId: string;
  nonce: string;
  job: QueryJob;
  executionMode: "submit" | "observe_only";
  executionSurface?: VisibleWorkerSurface;
  submittedAt?: number;
  reloadExtraction?: boolean;
}

export interface GeminiAnswerMessage {
  type: "GEMINI_ANSWER";
  sourceTabId: number;
  panelInstanceId: string;
  frameInstanceId: string;
  nonce: string;
  answer: StructuredAnswer;
}

export interface GeminiRunFinishedMessage {
  type: "GEMINI_RUN_FINISHED";
  jobId: string;
  sourceTabId: number;
  panelInstanceId: string;
  frameInstanceId: string;
  nonce: string;
}

export interface GeminiTopLevelReadyMessage {
  type: "GEMINI_TOP_LEVEL_READY";
  frameInstanceId: string;
  sessionId: string;
}

export interface WorkerPopupIdleTimeoutMessage {
  type: "WORKER_POPUP_IDLE_TIMEOUT";
  sessionId: string;
  token: string;
}

export type WorkerPopupControlMessage =
  | {
      type: "WORKER_POPUP_SCHEDULE_IDLE";
      sessionId: string;
      token: string;
      deadline: number;
    }
  | {
      type: "WORKER_POPUP_CANCEL_IDLE";
      sessionId: string;
    }
  | {
      type: "WORKER_POPUP_CANCEL_JOB";
      sessionId: string;
      jobId: string;
      nonce: string;
    };

export interface GeminiAnswerAck {
  type: "GEMINI_ANSWER_ACK";
  accepted: boolean;
  jobId: string;
  frameInstanceId: string;
  nonce: string;
  documentId: string | null;
}

export interface GeminiTopLevelReadyResponse {
  accepted: boolean;
  run?: RunQueryFrameMessage;
}

export interface AnswerReadyMessage {
  type: "ANSWER_READY";
  answer: StructuredAnswer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function hasValidDetail(value: Record<string, unknown>): boolean {
  return (
    value.detail === undefined ||
    isBoundedString(value.detail, 1, MAX_MESSAGE_DETAIL_LENGTH)
  );
}

export function isGoogleToWorkerMessage(
  value: unknown,
): value is GoogleToWorkerMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type === "OPEN_GEMINI_TAB_FALLBACK" ||
    value.type === "RECREATE_WORKER_POPUP"
  ) {
    return isBoundedString(value.jobId, 1, 128);
  }

  return (
    (value.type === "GOOGLE_PAGE_READY" ||
      value.type === "START_QUERY" ||
      value.type === "QUEUE_QUERY") &&
    isBoundedString(value.query, 1, MAX_QUERY_LENGTH) &&
    isBoundedString(value.url, 1, MAX_SOURCE_URL_LENGTH) &&
    (value.type !== "QUEUE_QUERY" ||
      value.mode === "manual" ||
      value.mode === "auto")
  );
}

export function isGeminiStatusMessage(
  value: unknown,
): value is GeminiStatusMessage {
  return (
    isRecord(value) &&
    value.type === "GEMINI_STATUS" &&
    isBoundedString(value.jobId, 1, 128) &&
    isPositiveTabId(value.sourceTabId) &&
    isBoundedString(value.panelInstanceId, 1, 128) &&
    isBoundedString(value.frameInstanceId, 1, 128) &&
    isBoundedString(value.nonce, 16, 128) &&
    isJobStatus(value.status) &&
    hasValidDetail(value)
  );
}

export function isGeminiAnswerMessage(
  value: unknown,
): value is GeminiAnswerMessage {
  return (
    isRecord(value) &&
    value.type === "GEMINI_ANSWER" &&
    isPositiveTabId(value.sourceTabId) &&
    isBoundedString(value.panelInstanceId, 1, 128) &&
    isBoundedString(value.frameInstanceId, 1, 128) &&
    isBoundedString(value.nonce, 16, 128) &&
    isStructuredAnswer(value.answer) &&
    value.answer.sourceTabId === value.sourceTabId
  );
}

export function isGeminiRunFinishedMessage(
  value: unknown,
): value is GeminiRunFinishedMessage {
  return (
    isRecord(value) &&
    value.type === "GEMINI_RUN_FINISHED" &&
    isBoundedString(value.jobId, 1, 128) &&
    isPositiveTabId(value.sourceTabId) &&
    isBoundedString(value.panelInstanceId, 1, 128) &&
    isBoundedString(value.frameInstanceId, 1, 128) &&
    isBoundedString(value.nonce, 16, 128)
  );
}

export function isGeminiTopLevelReadyMessage(
  value: unknown,
): value is GeminiTopLevelReadyMessage {
  return (
    isRecord(value) &&
    value.type === "GEMINI_TOP_LEVEL_READY" &&
    isBoundedString(value.frameInstanceId, 1, 128) &&
    isBoundedString(value.sessionId, 16, 128)
  );
}

export function isWorkerPopupIdleTimeoutMessage(
  value: unknown,
): value is WorkerPopupIdleTimeoutMessage {
  return (
    isRecord(value) &&
    value.type === "WORKER_POPUP_IDLE_TIMEOUT" &&
    isBoundedString(value.sessionId, 16, 128) &&
    isBoundedString(value.token, 16, 128)
  );
}

export function isWorkerPopupControlMessage(
  value: unknown,
): value is WorkerPopupControlMessage {
  if (!isRecord(value) || !isBoundedString(value.sessionId, 16, 128)) {
    return false;
  }

  if (value.type === "WORKER_POPUP_CANCEL_IDLE") {
    return true;
  }

  if (value.type === "WORKER_POPUP_SCHEDULE_IDLE") {
    return (
      isBoundedString(value.token, 16, 128) &&
      typeof value.deadline === "number" &&
      Number.isFinite(value.deadline) &&
      value.deadline > 0
    );
  }

  return (
    value.type === "WORKER_POPUP_CANCEL_JOB" &&
    isBoundedString(value.jobId, 1, 128) &&
    isBoundedString(value.nonce, 16, 128)
  );
}

export function isGeminiAnswerAck(value: unknown): value is GeminiAnswerAck {
  return (
    isRecord(value) &&
    value.type === "GEMINI_ANSWER_ACK" &&
    typeof value.accepted === "boolean" &&
    isBoundedString(value.jobId, 1, 128) &&
    isBoundedString(value.frameInstanceId, 1, 128) &&
    isBoundedString(value.nonce, 16, 128) &&
    (value.documentId === null ||
      isBoundedString(value.documentId, 1, 128))
  );
}

export function matchesPendingGeminiStatus(
  message: GeminiStatusMessage,
  expected: {
    jobId: string;
    sourceTabId: number;
    panelInstanceId: string;
    nonce: string;
  },
): boolean {
  return (
    message.jobId === expected.jobId &&
    message.sourceTabId === expected.sourceTabId &&
    message.panelInstanceId === expected.panelInstanceId &&
    message.nonce === expected.nonce
  );
}

export function matchesPendingGeminiAnswer(
  message: GeminiAnswerMessage,
  expected: {
    jobId: string;
    sourceTabId: number;
    panelInstanceId: string;
    nonce: string;
  },
): boolean {
  return (
    message.answer.jobId === expected.jobId &&
    message.sourceTabId === expected.sourceTabId &&
    message.panelInstanceId === expected.panelInstanceId &&
    message.nonce === expected.nonce
  );
}

export function matchesPendingGeminiRunFinished(
  message: GeminiRunFinishedMessage,
  expected: {
    jobId: string;
    sourceTabId: number;
    panelInstanceId: string;
    nonce: string;
  },
): boolean {
  return (
    message.jobId === expected.jobId &&
    message.sourceTabId === expected.sourceTabId &&
    message.panelInstanceId === expected.panelInstanceId &&
    message.nonce === expected.nonce
  );
}
