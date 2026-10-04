import { isStructuredAnswer, MAX_ANSWER_TEXT_LENGTH, type StructuredAnswer } from "../shared/answer-models";
import { isJobStatus, isQueryJob, type JobStatus, type QueryJob } from "../shared/query-models";
import { readGoogleQuery } from "../content/google/query-observer";
import { sanitizeConversationUrl } from "../shared/conversation-url";
import { MAX_PROMPT_LENGTH } from "./preferences";

export const LEGACY_REQUEST_KEY = "gsb-userscript:v4:request";
export const REQUEST_KEY = "gsb-userscript:v5:request";
export const REPLY_KEY = "gsb-userscript:v4:reply";
export const WORKER_KEY = "gsb-userscript:v4:worker";
export const SETTINGS_KEY = "gsb-userscript:v4:settings";
export const FOCUS_KEY = "gsb-userscript:v4:focus";
export const FOCUS_ACK_KEY = "gsb-userscript:v4:focus-ack";
export const RECEIPTS_KEY = "gsb-userscript:v4:receipts";
export const FOCUS_MAX_AGE_MS = 10_000;
export const MAX_JOB_AGE_MS = 300_000;
export const WORKER_MAX_AGE_MS = 20_000;

export type UserscriptJob = QueryJob & { promptText: string };

export interface UserscriptRequest {
  workerId: string;
  job: UserscriptJob;
  version: 5;
}

export interface UserscriptReply {
  jobId: string;
  sourceTabId: number;
  status: JobStatus;
  updatedAt: number;
  detail?: string;
  answer?: StructuredAnswer;
  progressText?: string;
  conversationUrl?: string;
}

export interface UserscriptWorker {
  id: string;
  seenAt: number;
  visible: boolean;
  busy: boolean;
  pipReady?: boolean;
  protocolVersion?: number;
  activeJobId?: string;
}

export interface UserscriptFocusRequest {
  workerId: string;
  nonce: string;
  createdAt: number;
}

export interface UserscriptFocusAck extends UserscriptFocusRequest {
  checkedAt: number;
  visible: boolean;
  hasFocus: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isWorkerId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function isUserscriptJob(value: unknown): value is UserscriptJob {
  return isQueryJob(value) && "promptText" in value && typeof value.promptText === "string" &&
    value.promptText.trim().length > 0 && value.promptText.length <= MAX_PROMPT_LENGTH;
}

export function isUserscriptRequest(value: unknown): value is UserscriptRequest {
  return record(value) && isWorkerId(value.workerId) && isUserscriptJob(value.job) &&
    value.version === 5 &&
    readGoogleQuery(value.job.sourceUrl) === value.job.query;
}

export function isUserscriptReply(value: unknown): value is UserscriptReply {
  if (!record(value) || typeof value.jobId !== "string" || value.jobId.length < 1 || value.jobId.length > 128 ||
      !Number.isInteger(value.sourceTabId) || typeof value.sourceTabId !== "number" || value.sourceTabId < 1 ||
      !isJobStatus(value.status) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0 ||
      (value.detail !== undefined && (typeof value.detail !== "string" || value.detail.length > 500)) ||
      (value.progressText !== undefined && (value.status !== "generating" || typeof value.progressText !== "string" || value.progressText.length > MAX_ANSWER_TEXT_LENGTH)) ||
      (value.conversationUrl !== undefined && (sanitizeConversationUrl(value.conversationUrl) !== value.conversationUrl ||
        (value.status !== "generating" && value.status !== "completed")))) {
    return false;
  }
  return value.status === "completed"
    ? isStructuredAnswer(value.answer) && value.answer.jobId === value.jobId && value.answer.sourceTabId === value.sourceTabId
    : value.answer === undefined;
}

export function storedWorker(value: unknown): UserscriptWorker | null {
  return record(value) && isWorkerId(value.id) && typeof value.seenAt === "number" &&
    Number.isFinite(value.seenAt) && value.seenAt > 0 &&
    typeof value.visible === "boolean" && typeof value.busy === "boolean" &&
    (value.pipReady === undefined || typeof value.pipReady === "boolean")
    ? value as unknown as UserscriptWorker : null;
}

export function liveWorker(value: unknown, now = Date.now()): UserscriptWorker | null {
  const worker = storedWorker(value);
  return worker && now >= worker.seenAt && now - worker.seenAt <= WORKER_MAX_AGE_MS ? worker : null;
}

export function isFocusRequest(value: unknown, now = Date.now()): value is UserscriptFocusRequest {
  return record(value) && isWorkerId(value.workerId) && isWorkerId(value.nonce) &&
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt > 0 &&
    now >= value.createdAt && now - value.createdAt < FOCUS_MAX_AGE_MS;
}

export function isFocusAck(value: unknown, now = Date.now()): value is UserscriptFocusAck {
  return record(value) && isFocusRequest(value, now) && typeof value.checkedAt === "number" &&
    value.checkedAt >= value.createdAt && value.checkedAt <= now &&
    typeof value.visible === "boolean" && typeof value.hasFocus === "boolean";
}

export function pendingRequest(value: unknown, now = Date.now()): UserscriptRequest | null {
  return isUserscriptRequest(value) && now >= value.job.createdAt &&
    now - value.job.createdAt < MAX_JOB_AGE_MS ? value : null;
}
