export type Language = "ja" | "en";
export type LanguageSetting = "auto" | Language;
export interface Preferences { version: 1; language: LanguageSetting; promptTemplate: string | null }
export const PREFERENCES_KEY = "gsb-userscript:preferences";
export const PROMPT_PLACEHOLDER = "%%prompt%%";
export const MAX_TEMPLATE_LENGTH = 4_096;
export const MAX_PROMPT_LENGTH = 16_384;
export const DEFAULT_TEMPLATES: Record<Language, string> = {
  ja: "ウェブ検索し参照を明示: %%prompt%%",
  en: "Search the web and cite your sources: %%prompt%%",
};

export function readPreferences(): Preferences {
  const stored = typeof GM_getValue === "function" ? GM_getValue<unknown>(PREFERENCES_KEY, null) : null;
  const value = typeof stored === "object" && stored !== null ? stored as Record<string, unknown> : {};
  return { version: 1,
    language: value.language === "ja" || value.language === "en" ? value.language : "auto",
    promptTemplate: typeof value.promptTemplate === "string" ? value.promptTemplate : null };
}

export function resolveLanguage(setting: LanguageSetting, browserLanguage: string): Language {
  return setting === "auto" ? browserLanguage.toLowerCase().startsWith("ja") ? "ja" : "en" : setting;
}

export function getLanguage(): Language {
  return resolveLanguage(readPreferences().language, browserLanguage());
}

function browserLanguage(): string {
  return typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "ja";
}

export function validateTemplate(template: string): void {
  if (!template.includes(PROMPT_PLACEHOLDER)) throw new Error("テンプレートに %%prompt%% を含めてください。");
  if (template.length > MAX_TEMPLATE_LENGTH) throw new Error("テンプレートは4096文字以内にしてください。");
}

export function savePreferences(next: Pick<Preferences, "language" | "promptTemplate">): Preferences {
  if (!["auto", "ja", "en"].includes(next.language)) throw new Error("表示言語を選択してください。");
  if (next.promptTemplate !== null) validateTemplate(next.promptTemplate);
  const value: Preferences = { version: 1, ...next };
  GM_setValue(PREFERENCES_KEY, value);
  return value;
}

export function formatPrompt(query: string, preferences = readPreferences(), language = resolveLanguage(preferences.language, browserLanguage())): string {
  const template = preferences.promptTemplate ?? DEFAULT_TEMPLATES[language];
  validateTemplate(template);
  // Literal, one-pass substitution: query text containing $& or %%prompt%% is not evaluated.
  const prompt = template.split(PROMPT_PLACEHOLDER).join(query);
  if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) throw new Error("送信プロンプトは16384文字以内にしてください。");
  return prompt;
}
