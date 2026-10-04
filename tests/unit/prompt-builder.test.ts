import { describe, expect, it } from "vitest";

import { buildPrompt } from "../../src/shared/prompt-builder";

describe("Gemini prompt builder", () => {
  it("uses the query alone in raw mode", () => {
    expect(buildPrompt("Chrome extension", "raw")).toBe("Chrome extension");
  });

  it("adds only the documented research instructions", () => {
    const prompt = buildPrompt("Chrome extension", "research");

    expect(prompt).toContain("以下のGoogle検索クエリに回答してください。");
    expect(prompt).toContain("検索クエリ:\nChrome extension");
    expect(prompt).not.toContain("検索結果本文");
  });
});
