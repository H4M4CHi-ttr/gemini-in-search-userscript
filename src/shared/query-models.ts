export const MAX_QUERY_LENGTH = 4_096;
export const MAX_SOURCE_URL_LENGTH = 8_192;
export const MAX_MESSAGE_DETAIL_LENGTH = 500;

export type QueryMode = "manual" | "auto";
export type PromptMode = "raw" | "research";

export interface QueryJob {
  id: string;
  sourceTabId: number;
  query: string;
  sourceUrl: string;
  createdAt: number;
  mode: QueryMode;
  conversationMode: "new_chat";
  promptMode: PromptMode;
  panelSessionId?: string;
}

export type JobStatus =
  | "queued"
  | "panel_required"
  | "preparing_frame"
  | "loading_gemini"
  | "gemini_ready"
  | "starting_new_chat"
  | "filling_prompt"
  | "submitting"
  | "generating"
  | "completed"
  | "manual_intervention"
  | "not_logged_in"
  | "rate_limited"
  | "frame_blocked"
  | "selector_not_found"
  | "timed_out"
  | "cancelled"
  | "failed";

const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "panel_required",
  "preparing_frame",
  "loading_gemini",
  "gemini_ready",
  "starting_new_chat",
  "filling_prompt",
  "submitting",
  "generating",
  "completed",
  "manual_intervention",
  "not_logged_in",
  "rate_limited",
  "frame_blocked",
  "selector_not_found",
  "timed_out",
  "cancelled",
  "failed",
];

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

export function isPositiveTabId(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === "string" &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function isQueryJob(value: unknown): value is QueryJob {
  if (!isRecord(value)) {
    return false;
  }

  const validPanelSessionId =
    value.panelSessionId === undefined ||
    isBoundedString(value.panelSessionId, 1, 128);

  return (
    isBoundedString(value.id, 1, 128) &&
    isPositiveTabId(value.sourceTabId) &&
    isBoundedString(value.query, 1, MAX_QUERY_LENGTH) &&
    isBoundedString(value.sourceUrl, 1, MAX_SOURCE_URL_LENGTH) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt > 0 &&
    (value.mode === "manual" || value.mode === "auto") &&
    value.conversationMode === "new_chat" &&
    (value.promptMode === "raw" || value.promptMode === "research") &&
    validPanelSessionId
  );
}

export interface CreateQueryJobInput {
  sourceTabId: number;
  query: string;
  sourceUrl: string;
  mode: QueryMode;
  promptMode: PromptMode;
}

export interface QueryJobDependencies {
  createId(): string;
  now(): number;
}

export function createQueryJob(
  input: CreateQueryJobInput,
  dependencies: QueryJobDependencies = {
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  },
): QueryJob {
  const query = input.query.trim().slice(0, MAX_QUERY_LENGTH);
  const sourceUrl = input.sourceUrl.slice(0, MAX_SOURCE_URL_LENGTH);

  if (!isPositiveTabId(input.sourceTabId)) {
    throw new Error("A positive source tab id is required.");
  }

  if (!query) {
    throw new Error("A non-empty query is required.");
  }

  if (!sourceUrl) {
    throw new Error("A source URL is required.");
  }

  const job: QueryJob = {
    id: dependencies.createId(),
    sourceTabId: input.sourceTabId,
    query,
    sourceUrl,
    createdAt: dependencies.now(),
    mode: input.mode,
    conversationMode: "new_chat",
    promptMode: input.promptMode,
  };

  if (!isQueryJob(job)) {
    throw new Error("Could not create a valid query job.");
  }

  return job;
}
