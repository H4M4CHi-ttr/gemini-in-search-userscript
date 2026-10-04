import { describe, expect, it } from "vitest";
import { sanitizeConversationUrl } from "../../src/shared/conversation-url";

describe("native Gemini conversation URL boundary", () => {
  it("accepts a direct or account-specific native conversation without changing it", () => {
    for (const url of ["https://gemini.google.com/app/ab123", "https://gemini.google.com/u/12/app/abc_123-45"]) {
      expect(sanitizeConversationUrl(url)).toBe(url);
    }
  });
  it("rejects the home page and every credential, port, query, fragment, foreign-host or ambiguous path form", () => {
    for (const value of [
      null, {}, "", "https://gemini.google.com/app", "https://gemini.google.com/app/",
      "http://gemini.google.com/app/id", "https://gemini.google.com.evil.example/app/id",
      "https://user@gemini.google.com/app/id", "https://gemini.google.com:443/app/id",
      "https://gemini.google.com/app/id?q=x", "https://gemini.google.com/app/id#x",
      " https://gemini.google.com/app/id", "https://gemini.google.com/app/id\n",
      "https://gemini.google.com/app/id/", "https://gemini.google.com/app/../id",
      "https://gemini.google.com/app/%69d", "https://gemini.google.com/u/me/app/id",
      "https://gemini.google.com/share/id", "javascript:alert(1)",
    ]) expect(sanitizeConversationUrl(value), String(value)).toBeNull();
  });
});
