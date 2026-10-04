import type { PromptMode } from "./query-models";

export function buildPrompt(query: string, mode: PromptMode): string {
  if (mode === "raw") {
    return query;
  }

  return `以下のGoogle検索クエリに回答してください。

必要に応じて最新のウェブ情報を確認し、最初に簡潔な結論を示してください。
続いて根拠、注意点、不確実な点を整理してください。
事実と推測を区別し、重要な主張には確認可能な出典を示してください。

検索クエリ:
${query}`;
}
