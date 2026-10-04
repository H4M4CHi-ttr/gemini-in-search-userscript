import { describe, expect, it } from "vitest";

import {
  GOOGLE_QUERY_DEBOUNCE_MS,
  isSupportedGoogleSearchUrl,
  readGoogleQuery,
} from "../../src/content/google/query-observer";

describe("Google Search query detection", () => {
  it("reads trimmed queries only from the approved Google Search hosts", () => {
    expect(readGoogleQuery("https://www.google.com/search?q=%20Gemini%20")).toBe(
      "Gemini",
    );
    expect(readGoogleQuery("https://www.google.co.jp/search?q=Chrome")).toBe(
      "Chrome",
    );
    expect(readGoogleQuery("https://google.com/search?q=blocked")).toBeNull();
    expect(readGoogleQuery("https://www.google.com/maps?q=blocked")).toBeNull();
    expect(readGoogleQuery("http://www.google.com/search?q=blocked")).toBeNull();
  });

  it("rejects empty queries and truncates queries at 4096 characters", () => {
    expect(readGoogleQuery("https://www.google.com/search?q=%20%20")).toBeNull();
    expect(
      readGoogleQuery(`https://www.google.com/search?q=${"x".repeat(5_000)}`),
    ).toHaveLength(4_096);
  });

  it("validates the complete URL shape", () => {
    expect(isSupportedGoogleSearchUrl("https://www.google.com/search?q=x")).toBe(
      true,
    );
    expect(isSupportedGoogleSearchUrl("not a url")).toBe(false);
  });

  it("uses the design-specified 600 ms query debounce", () => {
    expect(GOOGLE_QUERY_DEBOUNCE_MS).toBe(600);
  });
});
