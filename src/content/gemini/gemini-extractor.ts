import type {
  AnswerBlock,
  SafeLink,
  StructuredAnswer,
} from "../../shared/answer-models";
import { GEMINI_SELECTORS } from "./gemini-selectors";

// Keep content-script runtime dependencies local. MV3 content scripts are
// classic scripts and cannot import a shared ESM chunk emitted by the build.
const MAX_ANSWER_TEXT_LENGTH = 200_000;
const MAX_ANSWER_BLOCKS = 500;
const MAX_ANSWER_BLOCK_TEXT_LENGTH = 50_000;
const MAX_ANSWER_LIST_ITEMS = 500;
const MAX_ANSWER_LINKS = 100;
const MAX_ANSWER_LINK_LABEL_LENGTH = 1_000;
const MAX_LINK_URL_LENGTH = 8_192;

const IGNORED_ANSWER_ELEMENTS = new Set([
  "button",
  "source-footnote",
  "source-inline-chip",
  "sources-carousel-inline",
  "script",
  "style",
]);

function sanitizeHttpUrl(value: string): string | null {
  if (value.length < 1 || value.length > MAX_LINK_URL_LENGTH) {
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

export interface NormalizedAnswerNode {
  tag: string;
  text: string;
  children: NormalizedAnswerNode[];
  language?: string;
}

export interface AnswerMetadata {
  jobId: string;
  sourceTabId: number;
  completedAt: number;
  modelLabel?: string;
}

export function normalizeAnswerText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCodeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[\t ]*\n)+/, "")
    .replace(/(?:\n[\t ]*)+$/, "")
    .slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH);
}

function boundedText(value: string): string {
  return normalizeAnswerText(value).slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH);
}

function readElementText(element: Element): string {
  const clone = element.cloneNode(true);

  if (!(clone instanceof Element)) {
    return "";
  }

  for (const ignored of clone.querySelectorAll(
    [...IGNORED_ANSWER_ELEMENTS].join(","),
  )) {
    ignored.remove();
  }

  return boundedText(clone.textContent ?? "");
}

function languageFromElement(element: Element): string | undefined {
  const code = element.matches("code") ? element : element.querySelector("code");
  const languageClass = code
    ? [...code.classList].find((className) => className.startsWith("language-"))
    : undefined;
  const language = languageClass?.slice("language-".length, 64).trim();
  return language || undefined;
}

function normalizeDomNode(element: Element): NormalizedAnswerNode | null {
  const tag = element.tagName.toLowerCase();

  if (
    IGNORED_ANSWER_ELEMENTS.has(tag) ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return null;
  }

  const children = [...element.children]
    .map(normalizeDomNode)
    .filter((child): child is NormalizedAnswerNode => child !== null);
  const node: NormalizedAnswerNode = {
    tag,
    text:
      tag === "pre"
        ? normalizeCodeText(
            (element.querySelector("code") ?? element).textContent ?? "",
          )
        : readElementText(element),
    children,
  };
  const language = languageFromElement(element);

  if (language) {
    node.language = language;
  }

  return node;
}

function pushBlock(blocks: AnswerBlock[], block: AnswerBlock): void {
  if (blocks.length < MAX_ANSWER_BLOCKS) {
    blocks.push(block);
  }
}

function collectBlocks(
  nodes: readonly NormalizedAnswerNode[],
  blocks: AnswerBlock[],
): void {
  for (const node of nodes) {
    if (blocks.length >= MAX_ANSWER_BLOCKS) {
      return;
    }

    if (!node.text && node.children.length === 0) {
      continue;
    }

    if (/^h[1-6]$/.test(node.tag) && node.text) {
      const rawLevel = Number(node.tag.slice(1));
      const level = Math.min(3, Math.max(1, rawLevel)) as 1 | 2 | 3;
      pushBlock(blocks, { type: "heading", level, text: boundedText(node.text) });
      continue;
    }

    if (node.tag === "p" && node.text) {
      pushBlock(blocks, { type: "paragraph", text: boundedText(node.text) });
      continue;
    }

    if (node.tag === "blockquote" && node.text) {
      pushBlock(blocks, { type: "quote", text: boundedText(node.text) });
      continue;
    }

    if (node.tag === "pre" && node.text) {
      const codeBlock: AnswerBlock = node.language
        ? {
            type: "code",
            language: node.language,
            code: node.text.slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH),
          }
        : {
            type: "code",
            code: node.text.slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH),
          };
      pushBlock(blocks, codeBlock);
      continue;
    }

    if (node.tag === "ul" || node.tag === "ol") {
      const items = node.children
        .filter((child) => child.tag === "li" && child.text)
        .map((child) => boundedText(child.text))
        .slice(0, MAX_ANSWER_LIST_ITEMS);

      if (items.length > 0) {
        pushBlock(blocks, {
          type: "list",
          ordered: node.tag === "ol",
          items,
        });
      }

      continue;
    }

    const blockCountBeforeChildren = blocks.length;
    collectBlocks(node.children, blocks);

    if (
      blocks.length === blockCountBeforeChildren &&
      node.text &&
      node.tag !== "li"
    ) {
      pushBlock(blocks, { type: "paragraph", text: boundedText(node.text) });
    }
  }
}

export function blocksFromNormalizedNodes(
  nodes: readonly NormalizedAnswerNode[],
): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  collectBlocks(nodes, blocks);
  return blocks;
}

export function plainTextFromBlocks(blocks: readonly AnswerBlock[]): string {
  const parts = blocks.map((block) => {
    if (block.type === "list") {
      return block.items
        .map((item, index) =>
          block.ordered ? `${index + 1}. ${item}` : `- ${item}`,
        )
        .join("\n");
    }

    return block.type === "code" ? block.code : block.text;
  });
  return parts.join("\n\n").slice(0, MAX_ANSWER_TEXT_LENGTH).trim();
}

export function findAnswerContent(responseRoot: Element): Element | null {
  for (const selector of GEMINI_SELECTORS.answerContents) {
    try {
      const match = responseRoot.querySelector(selector);

      if (match) {
        return match;
      }
    } catch {
      // Keep probing the remaining compatibility selectors.
    }
  }

  return null;
}

function extractSafeLinks(content: Element): SafeLink[] {
  const links: SafeLink[] = [];
  const seen = new Set<string>();

  for (const anchor of content.querySelectorAll("a[href]")) {
    if (links.length >= MAX_ANSWER_LINKS) {
      break;
    }

    const rawUrl = anchor instanceof HTMLAnchorElement
      ? anchor.href
      : anchor.getAttribute("href") ?? "";
    const url = sanitizeHttpUrl(rawUrl);

    if (!url) {
      continue;
    }

    let label = boundedText(anchor.textContent ?? "").slice(
      0,
      MAX_ANSWER_LINK_LABEL_LENGTH,
    );

    if (!label) {
      label = new URL(url).hostname.slice(0, MAX_ANSWER_LINK_LABEL_LENGTH);
    }

    const key = `${label}\n${url}`;

    if (!seen.has(key)) {
      seen.add(key);
      links.push({ label, url });
    }
  }

  return links;
}

export function extractStructuredAnswer(
  responseRoot: Element,
  metadata: AnswerMetadata,
): StructuredAnswer {
  const content = findAnswerContent(responseRoot);

  if (!content) {
    throw new Error("Gemini answer content was not found.");
  }

  const normalizedChildren = [...content.children]
    .map(normalizeDomNode)
    .filter((node): node is NormalizedAnswerNode => node !== null);
  let blocks = blocksFromNormalizedNodes(normalizedChildren);

  if (blocks.length === 0) {
    const fallbackText = readElementText(content);

    if (fallbackText) {
      blocks = [{ type: "paragraph", text: fallbackText }];
    }
  }

  const plainText = plainTextFromBlocks(blocks);

  if (!plainText) {
    throw new Error("Gemini answer text was empty.");
  }

  const answer: StructuredAnswer = metadata.modelLabel
    ? {
        jobId: metadata.jobId,
        sourceTabId: metadata.sourceTabId,
        blocks,
        plainText,
        links: extractSafeLinks(content),
        completedAt: metadata.completedAt,
        modelLabel: metadata.modelLabel.slice(0, 200),
      }
    : {
        jobId: metadata.jobId,
        sourceTabId: metadata.sourceTabId,
        blocks,
        plainText,
        links: extractSafeLinks(content),
        completedAt: metadata.completedAt,
      };

  return answer;
}
