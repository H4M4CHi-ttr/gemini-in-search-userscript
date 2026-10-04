import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  resolveCardLanguage,
  sanitizeCardLink,
} from "../../src/content/google/card-view";

const source = readFileSync(
  fileURLToPath(
    new URL("../../src/content/google/card-view.ts", import.meta.url),
  ),
  "utf8",
);

describe("StructuredAnswer card rendering", () => {
  it("allows only HTTP links at the final render boundary", () => {
    expect(sanitizeCardLink("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(sanitizeCardLink("javascript:alert(1)")).toBeNull();
  });

  it("resolves explicit and automatic Japanese or English UI language", () => {
    expect(resolveCardLanguage("ja", "en-US")).toBe("ja");
    expect(resolveCardLanguage("auto", "ja-JP")).toBe("ja");
    expect(resolveCardLanguage("auto", "en-US")).toBe("en");
  });

  it("renders with DOM text APIs and safe external-link attributes", () => {
    expect(source).toContain("renderAnswer(answer: StructuredAnswer)");
    expect(source).toContain('anchor.target = "_blank"');
    expect(source).toContain('anchor.rel = "noopener noreferrer"');
    expect(source).toContain('this.text("Geminiで開く")');
    expect(source).toContain("navigator.clipboard");
    expect(source).toContain('this.text("再生成")');
    expect(source).toContain('document.createElement("details")');
    expect(source).toContain('this.text("非公式拡張")');
    expect(source).not.toContain(".innerHTML");
  });
});
