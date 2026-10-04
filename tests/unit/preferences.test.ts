import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEMPLATES, formatPrompt, getLanguage, MAX_PROMPT_LENGTH, MAX_TEMPLATE_LENGTH,
  PREFERENCES_KEY, readPreferences, resolveLanguage, savePreferences } from "../../src/userscript/preferences";
import { acceptConsent } from "../../src/userscript/settings";
import { localized, translate } from "../../src/userscript/i18n";

afterEach(() => vi.unstubAllGlobals());
function storeSetup(language = "ja-JP") {
  const store = new Map<string, unknown>();
  vi.stubGlobal("navigator", { language });
  vi.stubGlobal("GM_getValue", (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal("GM_setValue", (key: string, value: unknown) => store.set(key, value));
  return store;
}

describe("localized prompt preferences", () => {
  it("uses the exact Japanese prefix and its English counterpart without an API", () => {
    storeSetup();
    expect(formatPrompt("2+2")).toBe("ウェブ検索し参照を明示: 2+2");
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(formatPrompt("2+2")).toBe("Search the web and cite your sources: 2+2");
    expect(DEFAULT_TEMPLATES.ja).toBe("ウェブ検索し参照を明示: %%prompt%%");
  });
  it("resolves an explicit language and defaults other browser languages to English", () => {
    const store = storeSetup("en-US");
    expect(resolveLanguage("auto", "ja-JP")).toBe("ja");
    expect(resolveLanguage("auto", "fr")).toBe("en");
    savePreferences({ language: "ja", promptTemplate: null });
    expect(getLanguage()).toBe("ja");
    expect(translate("もっと見る")).toBe("もっと見る");
    savePreferences({ language: "en", promptTemplate: null });
    expect(translate("もっと見る")).toBe("Show more");
    expect(localized("設定", "Settings")).toBe("Settings");
    expect(store.has(PREFERENCES_KEY)).toBe(true);
    expect(formatPrompt("q", { version: 1, language: "ja", promptTemplate: null })).toBe("ウェブ検索し参照を明示: q");
  });
  it("replaces every placeholder literally once, including special replacement syntax", () => {
    storeSetup();
    const preferences = { version: 1 as const, language: "ja" as const, promptTemplate: "First %%prompt%%\nSecond %%prompt%%" };
    const query = "$& $` $' %%prompt%% <script>literal</script>";
    expect(formatPrompt(query, preferences)).toBe(`First ${query}\nSecond ${query}`);
  });
  it("rejects invalid or oversized templates and expanded prompts without truncating", () => {
    const store = storeSetup();
    expect(() => savePreferences({ language: "auto", promptTemplate: "no placeholder" })).toThrow(/%%prompt%%/);
    expect(() => savePreferences({ language: "auto", promptTemplate: "x".repeat(MAX_TEMPLATE_LENGTH) + "%%prompt%%" })).toThrow(/4096/);
    expect(store.size).toBe(0);
    const preferences = { version: 1 as const, language: "en" as const, promptTemplate: "%%prompt%%" };
    expect(formatPrompt("x".repeat(MAX_PROMPT_LENGTH), preferences)).toHaveLength(MAX_PROMPT_LENGTH);
    expect(() => formatPrompt("x".repeat(MAX_PROMPT_LENGTH + 1), preferences)).toThrow(/16384/);
    expect(() => formatPrompt("x".repeat(4096), { ...preferences, promptTemplate: "%%prompt%%".repeat(5) })).toThrow(/16384/);
  });
  it("keeps custom preferences across consent operations and restores language-aware defaults", () => {
    storeSetup();
    savePreferences({ language: "en", promptTemplate: "Briefly: %%prompt%%" });
    acceptConsent();
    expect(readPreferences().promptTemplate).toBe("Briefly: %%prompt%%");
    expect(formatPrompt("query")).toBe("Briefly: query");
    savePreferences({ language: "en", promptTemplate: null });
    expect(formatPrompt("query")).toBe("Search the web and cite your sources: query");
  });
});
