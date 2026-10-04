import { describe, expect, it } from "vitest";

import {
  isStructuredAnswer,
  sanitizeHttpUrl,
  type StructuredAnswer,
} from "../../src/shared/answer-models";

const answer: StructuredAnswer = {
  jobId: "job-1",
  sourceTabId: 4,
  blocks: [
    { type: "heading", level: 1, text: "Synthetic answer" },
    { type: "paragraph", text: "No user data." },
  ],
  plainText: "Synthetic answer\n\nNo user data.",
  links: [{ label: "Example", url: "https://example.com/" }],
  completedAt: 1_777_777,
};

describe("StructuredAnswer validation", () => {
  it("accepts bounded structured answers with normalized HTTP links", () => {
    expect(isStructuredAnswer(answer)).toBe(true);
    expect(sanitizeHttpUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(sanitizeHttpUrl("http://example.com/path")).toBe(
      "http://example.com/path",
    );
  });

  it("rejects unsafe links, invalid tabs, and raw HTML-shaped fields", () => {
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpUrl("data:text/html,test")).toBeNull();
    expect(
      isStructuredAnswer({
        ...answer,
        links: [{ label: "Unsafe", url: "javascript:alert(1)" }],
      }),
    ).toBe(false);
    expect(isStructuredAnswer({ ...answer, sourceTabId: 0 })).toBe(false);
    expect(
      isStructuredAnswer({ ...answer, blocks: [{ type: "html", html: "<b>x</b>" }] }),
    ).toBe(false);
  });
});
