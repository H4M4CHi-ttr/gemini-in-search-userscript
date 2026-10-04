import { isPositiveTabId, MAX_SOURCE_URL_LENGTH } from "./query-models";

export const MAX_ANSWER_TEXT_LENGTH = 200_000;
export const MAX_ANSWER_BLOCKS = 500;
export const MAX_ANSWER_BLOCK_TEXT_LENGTH = 50_000;
export const MAX_ANSWER_LIST_ITEMS = 500;
export const MAX_ANSWER_LINKS = 100;
export const MAX_ANSWER_LINK_LABEL_LENGTH = 1_000;
export const MAX_MODEL_LABEL_LENGTH = 200;

export type AnswerBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language?: string; code: string }
  | { type: "quote"; text: string };

export interface SafeLink {
  label: string;
  url: string;
}

export interface StructuredAnswer {
  jobId: string;
  sourceTabId: number;
  blocks: AnswerBlock[];
  plainText: string;
  links: SafeLink[];
  completedAt: number;
  modelLabel?: string;
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

export function sanitizeHttpUrl(value: string): string | null {
  if (value.length < 1 || value.length > MAX_SOURCE_URL_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function isAnswerBlock(value: unknown): value is AnswerBlock {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "paragraph" || value.type === "quote") {
    return isBoundedString(value.text, 1, MAX_ANSWER_BLOCK_TEXT_LENGTH);
  }

  if (value.type === "heading") {
    return (
      (value.level === 1 || value.level === 2 || value.level === 3) &&
      isBoundedString(value.text, 1, MAX_ANSWER_BLOCK_TEXT_LENGTH)
    );
  }

  if (value.type === "code") {
    return (
      isBoundedString(value.code, 1, MAX_ANSWER_BLOCK_TEXT_LENGTH) &&
      (value.language === undefined ||
        isBoundedString(value.language, 1, 64))
    );
  }

  if (value.type === "list") {
    return (
      typeof value.ordered === "boolean" &&
      Array.isArray(value.items) &&
      value.items.length >= 1 &&
      value.items.length <= MAX_ANSWER_LIST_ITEMS &&
      value.items.every((item) =>
        isBoundedString(item, 1, MAX_ANSWER_BLOCK_TEXT_LENGTH),
      )
    );
  }

  return false;
}

export function isSafeLink(value: unknown): value is SafeLink {
  return (
    isRecord(value) &&
    isBoundedString(value.label, 1, MAX_ANSWER_LINK_LABEL_LENGTH) &&
    typeof value.url === "string" &&
    sanitizeHttpUrl(value.url) === value.url
  );
}

export function isStructuredAnswer(
  value: unknown,
): value is StructuredAnswer {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isBoundedString(value.jobId, 1, 128) &&
    isPositiveTabId(value.sourceTabId) &&
    Array.isArray(value.blocks) &&
    value.blocks.length >= 1 &&
    value.blocks.length <= MAX_ANSWER_BLOCKS &&
    value.blocks.every(isAnswerBlock) &&
    isBoundedString(value.plainText, 1, MAX_ANSWER_TEXT_LENGTH) &&
    Array.isArray(value.links) &&
    value.links.length <= MAX_ANSWER_LINKS &&
    value.links.every(isSafeLink) &&
    typeof value.completedAt === "number" &&
    Number.isFinite(value.completedAt) &&
    value.completedAt > 0 &&
    (value.modelLabel === undefined ||
      isBoundedString(value.modelLabel, 1, MAX_MODEL_LABEL_LENGTH))
  );
}
