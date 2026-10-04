import { describe, expect, it } from "vitest";

import {
  blocksFromNormalizedNodes,
  normalizeAnswerText,
  normalizeCodeText,
  plainTextFromBlocks,
  type NormalizedAnswerNode,
} from "../../src/content/gemini/gemini-extractor";

function node(
  tag: string,
  text: string,
  children: NormalizedAnswerNode[] = [],
  language?: string,
): NormalizedAnswerNode {
  return language ? { tag, text, children, language } : { tag, text, children };
}

describe("Gemini structured answer extraction", () => {
  it("maps semantic answer nodes without carrying HTML", () => {
    const blocks = blocksFromNormalizedNodes([
      node("h2", "Synthetic heading"),
      node("p", "A <script> string remains plain text."),
      node("ul", "First Second", [
        node("li", "First"),
        node("li", "Second"),
      ]),
      node("pre", "const ok = true;", [], "ts"),
      node("blockquote", "Synthetic quote"),
    ]);

    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "Synthetic heading" },
      { type: "paragraph", text: "A <script> string remains plain text." },
      { type: "list", ordered: false, items: ["First", "Second"] },
      { type: "code", language: "ts", code: "const ok = true;" },
      { type: "quote", text: "Synthetic quote" },
    ]);
    expect(plainTextFromBlocks(blocks)).toContain("- First\n- Second");
  });

  it("recurses through layout containers without duplicating their text", () => {
    const blocks = blocksFromNormalizedNodes([
      node("div", "One Two", [node("p", "One"), node("p", "Two")]),
    ]);

    expect(blocks).toEqual([
      { type: "paragraph", text: "One" },
      { type: "paragraph", text: "Two" },
    ]);
  });

  it("normalizes cumulative DOM whitespace", () => {
    expect(normalizeAnswerText("  One\u00a0 two \n\n\n three  ")).toBe(
      "One two\n\nthree",
    );
  });

  it("preserves code indentation and line breaks", () => {
    expect(normalizeCodeText("\r\n  if (safe) {\r\n    run();\r\n  }\r\n")).toBe(
      "  if (safe) {\n    run();\n  }",
    );
  });
});
