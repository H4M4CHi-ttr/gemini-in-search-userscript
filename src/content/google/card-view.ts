import type { JobStatus } from "../../shared/query-models";
import type {
  AnswerBlock,
  StructuredAnswer,
} from "../../shared/answer-models";
import {
  PRODUCTION_EXECUTION_SURFACE,
  type VisibleWorkerSurface,
  type WorkerPopupIssue,
} from "../../shared/visible-worker-surface";

const INSERTION_ANCHORS = ["#search", "#rso", "#center_col", '[role="main"]'];
export const USERSCRIPT_USAGE_NOTICE = "使用中はGeminiウィンドウの一部が見える状態にしてください。最小化や完全に覆われると処理が一時停止する場合があります。「Geminiウィンドウを開く」で戻れます。";

export type CardLanguage = "ja" | "en";

export function resolveCardLanguage(
  setting: "auto" | CardLanguage,
  locale = document.documentElement.lang || navigator.language,
): CardLanguage {
  if (setting === "ja" || setting === "en") {
    return setting;
  }

  return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const ENGLISH_TEXT: Record<string, string> = {
  [USERSCRIPT_USAGE_NOTICE]: "Keep part of the Gemini window visible. Minimizing or fully covering it may pause processing. Use Open Gemini window to return to it.",
  "このユーザースクリプトを有効にすると、次の処理が行われます。":
    "Enabling this userscript allows the following actions.",
  "Gemini用の別ウィンドウを開きます。初回は前面に出る場合があります。":
    "A separate Gemini window opens. It may come to the front when first opened.",
  "非公式スクリプト": "Unofficial userscript",
  "この拡張機能を有効にすると、次の処理が行われます。":
    "Enabling this extension allows the following actions.",
  "小さなGemini処理用ウィンドウを背面に開きます。":
    "A small Gemini processing window opens in the background.",
  "処理用popupはGoogle検索からfocusを奪いません。":
    "The processing popup does not take focus from Google Search.",
  "処理用popupを最小化すると処理が停止します。":
    "Processing stops if the popup is minimized.",
  "検索語はご自身のGeminiへ送信され、履歴に残る可能性があります。":
    "The query is sent to your Gemini account and may remain in its history.",
  "開発者のサーバーには検索語や回答を送信しません。":
    "Queries and answers are not sent to the developer's server.",
  "ご自身のGoogle AI利用枠が使われる場合があります。":
    "Your own Google AI allowance may be used.",
  "前面の通常Geminiタブ方式も選べます。":
    "You can also choose to continue in a foreground normal Gemini tab.",
  "開発実験では、選択した可視surfaceでGeminiを開きます。":
    "In the development experiment, Gemini opens in the selected visible surface.",
  "内容を確認して有効化": "Review and enable",
  "同意設定を保存できませんでした。": "Could not save consent.",
  "Geminiでこの検索に回答": "Answer this search with Gemini",
  "ボタンを押すと、現在の検索語をGeminiへ送信します。":
    "Press the button to send the current search query to Gemini.",
  "自動モードでは、生成状態と回答をこのカード内で確認できます。":
    "In automatic mode, generation status and the answer appear in this card.",
  "Geminiで生成": "Generate with Gemini",
  "自動送信": "Automatic sending",
  "オフ": "Off",
  "オン": "On",
  "表示言語": "Language",
  "自動": "Auto",
  "日本語": "Japanese",
  "英語": "English",
  "実験surface": "Experiment surface",
  "前面の通常タブ（明示fallback）": "Foreground normal tab (explicit fallback)",
  "同一ウィンドウの非activeタブ（実験A）":
    "Inactive tab in the current window (Experiment A)",
  "専用popupウィンドウ（実験B/D）":
    "Dedicated popup window (Experiments B/D)",
  "最小化popup（実験C）": "Minimized popup (Experiment C)",
  "traceを保存": "Save trace",
  "traceを消去": "Reset trace",
  "非公式拡張": "Unofficial extension",
  "エラー": "Error",
  "再試行": "Retry",
  "通常タブでGeminiを開く": "Open Gemini in a normal tab",
  "通常タブで続行": "Continue in a normal tab",
  "背面ウィンドウを再作成": "Recreate background window",
  "同じ検索語は短時間の重複送信を防止しました。":
    "A recent duplicate of this query was not sent.",
  "次の検索を待機中です。": "The newest search is waiting.",
  "拡張機能が検索語をGeminiへ自動送信します。":
    "The extension will automatically send this query to Gemini.",
  "手動で再生成": "Regenerate manually",
  "Geminiによる回答": "Answer from Gemini",
  "回答を折りたたむ／展開する": "Collapse or expand answer",
  "出典": "Sources",
  "Geminiで開く": "Open in Gemini",
  "コピー": "Copy",
  "コピーしました": "Copied",
  "コピーできませんでした": "Could not copy",
  "再生成": "Regenerate",
  "再生成できませんでした。": "Could not regenerate.",
  "再試行できませんでした。": "Could not retry.",
  "Geminiの処理を開始できませんでした。":
    "Could not start the Gemini operation.",
  "Gemini Search Bridgeを初期化できませんでした。":
    "Could not initialize Gemini Search Bridge.",
};

const CARD_CSS = `
  :host {
    display: block;
    margin: 0 0 16px;
    color-scheme: light dark;
    font-family: Arial, sans-serif;
  }

  :host([data-floating="true"]) {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483646;
    width: min(360px, calc(100vw - 32px));
    margin: 0;
  }

  article {
    box-sizing: border-box;
    padding: 16px;
    border: 1px solid #dadce0;
    border-radius: 12px;
    background: #fff;
    color: #202124;
    box-shadow: 0 1px 2px rgb(60 64 67 / 0.12);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 16px;
    line-height: 1.35;
  }

  .card-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .unofficial {
    flex: 0 0 auto;
    color: #5f6368;
    font-size: 11px;
  }

  p,
  li {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
  }

  ul {
    display: grid;
    gap: 4px;
    margin: 8px 0 12px;
    padding-left: 20px;
  }

  .answer {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  .answer-details {
    margin-top: 10px;
  }

  .answer-details > summary {
    padding: 4px 0;
    color: #5f6368;
    cursor: pointer;
    font-size: 12px;
  }

  .answer h3,
  .answer h4,
  .answer h5,
  .sources h3 {
    margin: 4px 0 0;
    line-height: 1.4;
  }

  .answer h3,
  .sources h3 {
    font-size: 15px;
  }

  .answer h4 {
    font-size: 14px;
  }

  .answer h5 {
    font-size: 13px;
  }

  .answer pre {
    overflow: auto;
    margin: 0;
    padding: 10px;
    border-radius: 8px;
    background: #f1f3f4;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .answer blockquote {
    margin: 0;
    padding-left: 10px;
    border-left: 3px solid #dadce0;
    color: #5f6368;
  }

  .sources {
    margin-top: 14px;
  }

  .sources a {
    color: #1967d2;
    overflow-wrap: anywhere;
  }

  .answer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .answer-actions button.secondary {
    border-color: #dadce0;
    background: transparent;
    color: #1a73e8;
  }

  .detail {
    margin-top: 5px;
    color: #5f6368;
  }

  .preferences {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid #dadce0;
    color: #5f6368;
    font-size: 12px;
  }

  .preference {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .preference input,
  .preference select {
    min-height: 28px;
    font: inherit;
  }

  .diagnostic-controls {
    display: inline-flex;
    gap: 6px;
  }

  .diagnostic-controls button {
    min-height: 28px;
    margin: 0;
    padding: 4px 10px;
    border-color: #dadce0;
    background: transparent;
    color: #1a73e8;
    font-size: 12px;
  }

  button,
  .answer-actions a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    margin-top: 12px;
    padding: 7px 14px;
    border: 1px solid #1a73e8;
    border-radius: 18px;
    background: #1a73e8;
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }

  button:hover:not(:disabled),
  .answer-actions a:hover {
    background: #1558b0;
  }

  button:focus-visible,
  .answer-actions a:focus-visible {
    outline: 2px solid #1a73e8;
    outline-offset: 2px;
  }

  button:disabled {
    cursor: progress;
    opacity: 0.62;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #1a73e8;
  }

  .error .dot {
    background: #c5221f;
  }

  @media (prefers-color-scheme: dark) {
    article {
      border-color: #5f6368;
      background: #202124;
      color: #e8eaed;
    }

    .detail {
      color: #bdc1c6;
    }

    .unofficial,
    .answer-details > summary,
    .preferences {
      color: #bdc1c6;
    }

    .preferences {
      border-top-color: #5f6368;
    }

    .answer pre {
      background: #303134;
    }

    .answer blockquote {
      border-left-color: #5f6368;
      color: #bdc1c6;
    }

    .sources a,
    .answer-actions button.secondary {
      color: #8ab4f8;
    }
  }
`;

const STATUS_LABELS_JA: Record<JobStatus, string> = {
  queued: "検索語を待機キューへ追加しました…",
  panel_required: "Geminiのバックグラウンド処理を準備しています…",
  preparing_frame: "Geminiの表示を準備しています…",
  loading_gemini: "Geminiを読み込んでいます…",
  gemini_ready: "Geminiへ接続しました…",
  starting_new_chat: "新しいチャットを準備しています…",
  filling_prompt: "検索語を入力しています…",
  submitting: "検索語をGeminiへ送信しています…",
  generating: "Geminiが回答を生成しています…",
  completed: "Geminiで回答が完了しました",
  manual_intervention: "Geminiの処理に手動対応が必要です",
  not_logged_in: "Geminiへのログインが必要です",
  rate_limited: "Geminiの利用上限を確認してください",
  frame_blocked: "Geminiを埋め込み表示できませんでした",
  selector_not_found: "Geminiの入力欄を検出できませんでした",
  timed_out: "Geminiの準備がタイムアウトしました",
  cancelled: "処理を中止しました",
  failed: "Geminiへの送信に失敗しました",
};

const STATUS_LABELS_EN: Record<JobStatus, string> = {
  queued: "The newest search is waiting…",
  panel_required: "Preparing Gemini in the background…",
  preparing_frame: "Preparing the Gemini display…",
  loading_gemini: "Loading Gemini…",
  gemini_ready: "Connected to Gemini…",
  starting_new_chat: "Preparing a new chat…",
  filling_prompt: "Entering the search query…",
  submitting: "Automatically sending the query to Gemini…",
  generating: "Gemini is generating an answer…",
  completed: "Gemini finished the answer",
  manual_intervention: "The Gemini operation needs manual attention",
  not_logged_in: "Sign in to Gemini to continue",
  rate_limited: "Gemini reported a usage limit",
  frame_blocked: "Gemini could not be embedded",
  selector_not_found: "The Gemini prompt input could not be detected",
  timed_out: "Gemini reached the operation timeout",
  cancelled: "The operation was cancelled",
  failed: "Could not send the query to Gemini",
};

const ERROR_STATUSES = new Set<JobStatus>([
  "manual_intervention",
  "not_logged_in",
  "rate_limited",
  "frame_blocked",
  "selector_not_found",
  "timed_out",
  "cancelled",
  "failed",
]);

export interface SearchCardHandlers {
  onAcceptConsent(): Promise<void>;
  onRunQuery(): Promise<void>;
  onOpenFallback(): Promise<void>;
  onRecreateWorker(): Promise<void>;
  onAutoRunChange(enabled: boolean): Promise<void>;
  onLanguageChange(language: "auto" | CardLanguage): Promise<void>;
  onExecutionSurfaceChange(surface: VisibleWorkerSurface): Promise<void>;
  onDownloadTrace(): Promise<void>;
  onResetTrace(): Promise<void>;
}

export function sanitizeCardLink(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;

  if (className) {
    element.className = className;
  }

  return element;
}

export class SearchCardView {
  readonly host: HTMLDivElement;

  private readonly card: HTMLElement;
  private readonly handlers: SearchCardHandlers;
  private language: CardLanguage = "ja";
  private languageSetting: "auto" | CardLanguage = "auto";
  private autoRun = false;
  private executionSurface: VisibleWorkerSurface = PRODUCTION_EXECUTION_SURFACE;
  private visibleWorkerDiagnostics = false;
  private readonly usageNotice: HTMLParagraphElement | null;

  constructor(handlers: SearchCardHandlers, private readonly userscript = false) {
    this.handlers = handlers;
    this.host = document.createElement("div");
    this.host.id = "gemini-search-bridge-root";

    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CARD_CSS;
    this.card = document.createElement("article");
    this.card.setAttribute("aria-live", "polite");
    this.usageNotice = userscript ? textElement("p", USERSCRIPT_USAGE_NOTICE) : null;
    if (this.usageNotice) {
      this.usageNotice.setAttribute("role", "note");
      this.usageNotice.style.cssText = "padding:12px;margin:0 0 8px;border:1px solid #b8860b;border-radius:8px;font-size:14px;line-height:1.6;background:Canvas;color:CanvasText;";
      shadow.append(style, this.usageNotice, this.card);
    } else {
      shadow.append(style, this.card);
    }
  }

  setPreferences(
    language: CardLanguage,
    languageSetting: "auto" | CardLanguage,
    autoRun: boolean,
    executionSurface: VisibleWorkerSurface,
    visibleWorkerDiagnostics: boolean,
  ): void {
    this.language = language;
    this.languageSetting = languageSetting;
    this.autoRun = autoRun;
    this.executionSurface = executionSurface;
    this.visibleWorkerDiagnostics = visibleWorkerDiagnostics;
    this.card.lang = language;
    if (this.usageNotice) {
      this.usageNotice.textContent = this.text(USERSCRIPT_USAGE_NOTICE);
    }
  }

  private text(japanese: string): string {
    return this.language === "en"
      ? (ENGLISH_TEXT[japanese] ?? japanese)
      : japanese;
  }

  private heading(japaneseTitle: string): HTMLElement {
    const heading = document.createElement("div");
    heading.className = "card-heading";
    heading.append(
      textElement("h2", this.text(japaneseTitle)),
      textElement("span", this.userscript ? this.text("非公式スクリプト") : this.text("非公式拡張"), "unofficial"),
    );
    return heading;
  }

  private preferenceControls(includeAuto = true): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "preferences";

    if (includeAuto) {
      const autoLabel = document.createElement("label");
      autoLabel.className = "preference";
      const autoToggle = document.createElement("input");
      autoToggle.type = "checkbox";
      autoToggle.checked = this.autoRun;
      autoToggle.setAttribute("aria-label", this.text("自動送信"));
      autoToggle.addEventListener("change", () => {
        const enabled = autoToggle.checked;
        autoToggle.disabled = true;
        void this.handlers
          .onAutoRunChange(enabled)
          .then(() => {
            this.autoRun = enabled;
          })
          .catch(() => {
            autoToggle.checked = !enabled;
          })
          .finally(() => {
            autoToggle.disabled = false;
          });
      });
      autoLabel.append(
        autoToggle,
        document.createTextNode(
          `${this.text("自動送信")}: ${this.text(this.autoRun ? "オン" : "オフ")}`,
        ),
      );
      controls.append(autoLabel);
    }

    if (this.visibleWorkerDiagnostics) {
      const surfaceLabel = document.createElement("label");
      surfaceLabel.className = "preference";
      surfaceLabel.append(document.createTextNode(this.text("実験surface")));
      const surfaceSelect = document.createElement("select");
      surfaceSelect.setAttribute("aria-label", this.text("実験surface"));

      for (const [value, japaneseLabel] of [
        ["foreground_tab", "前面の通常タブ（明示fallback）"],
        ["background_tab", "同一ウィンドウの非activeタブ（実験A）"],
        ["popup_window", "専用popupウィンドウ（実験B/D）"],
        ["minimized_popup", "最小化popup（実験C）"],
      ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = this.text(japaneseLabel);
        option.selected = value === this.executionSurface;
        surfaceSelect.append(option);
      }

      surfaceSelect.addEventListener("change", () => {
        const value = surfaceSelect.value;

        if (
          value !== "foreground_tab" &&
          value !== "background_tab" &&
          value !== "popup_window" &&
          value !== "minimized_popup"
        ) {
          return;
        }

        surfaceSelect.disabled = true;
        void this.handlers.onExecutionSurfaceChange(value).catch(() => {
          surfaceSelect.value = this.executionSurface;
          surfaceSelect.disabled = false;
        });
      });
      surfaceLabel.append(surfaceSelect);
      controls.append(surfaceLabel);
    }

    const languageLabel = document.createElement("label");
    languageLabel.className = "preference";
    languageLabel.append(document.createTextNode(this.text("表示言語")));
    const languageSelect = document.createElement("select");
    languageSelect.setAttribute("aria-label", this.text("表示言語"));

    for (const [value, japaneseLabel] of [
      ["auto", "自動"],
      ["ja", "日本語"],
      ["en", "英語"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.text(japaneseLabel);
      option.selected = value === this.languageSetting;
      languageSelect.append(option);
    }

    languageSelect.addEventListener("change", () => {
      const value = languageSelect.value;

      if (value !== "auto" && value !== "ja" && value !== "en") {
        return;
      }

      languageSelect.disabled = true;
      void this.handlers.onLanguageChange(value).catch(() => {
        languageSelect.value = this.languageSetting;
        languageSelect.disabled = false;
      });
    });
    languageLabel.append(languageSelect);
    controls.append(languageLabel);

    if (this.visibleWorkerDiagnostics) {
      const diagnosticControls = document.createElement("span");
      diagnosticControls.className = "diagnostic-controls";
      const saveButton = textElement("button", this.text("traceを保存"));
      saveButton.type = "button";
      saveButton.addEventListener("click", () => {
        saveButton.disabled = true;
        void this.handlers.onDownloadTrace().finally(() => {
          saveButton.disabled = false;
        });
      });
      const resetButton = textElement("button", this.text("traceを消去"));
      resetButton.type = "button";
      resetButton.addEventListener("click", () => {
        resetButton.disabled = true;
        void this.handlers.onResetTrace().finally(() => {
          resetButton.disabled = false;
        });
      });
      diagnosticControls.append(saveButton, resetButton);
      controls.append(diagnosticControls);
    }
    return controls;
  }

  mount(): void {
    if (this.host.isConnected) {
      return;
    }

    const anchor = INSERTION_ANCHORS.map((selector) =>
      document.querySelector(selector),
    ).find((candidate): candidate is Element => candidate !== null);

    if (anchor?.parentElement) {
      this.host.dataset.floating = "false";
      anchor.parentElement.insertBefore(this.host, anchor);
      return;
    }

    this.host.dataset.floating = "true";
    document.body.append(this.host);
  }

  remove(): void {
    this.host.remove();
  }

  renderConsent(): void {
    const title = this.heading("Gemini Search Bridge");
    const introduction = textElement(
      "p",
      this.text(this.userscript
        ? "このユーザースクリプトを有効にすると、次の処理が行われます。"
        : "この拡張機能を有効にすると、次の処理が行われます。"),
    );
    const disclosures = document.createElement("ul");

    for (const disclosure of this.userscript ? [
      "Gemini用の別ウィンドウを開きます。初回は前面に出る場合があります。",
      USERSCRIPT_USAGE_NOTICE,
      "検索語はご自身のGeminiへ送信され、履歴に残る可能性があります。",
      "開発者のサーバーには検索語や回答を送信しません。",
      "ご自身のGoogle AI利用枠が使われる場合があります。",
    ] : [
      "小さなGemini処理用ウィンドウを背面に開きます。",
      "処理用popupはGoogle検索からfocusを奪いません。",
      "処理用popupを最小化すると処理が停止します。",
      "検索語はご自身のGeminiへ送信され、履歴に残る可能性があります。",
      "開発者のサーバーには検索語や回答を送信しません。",
      "ご自身のGoogle AI利用枠が使われる場合があります。",
      this.visibleWorkerDiagnostics
        ? "開発実験では、選択した可視surfaceでGeminiを開きます。"
        : "前面の通常Geminiタブ方式も選べます。",
    ]) {
      disclosures.append(textElement("li", this.text(disclosure)));
    }

    const acceptButton = textElement(
      "button",
      this.text("内容を確認して有効化"),
    );
    acceptButton.type = "button";
    acceptButton.setAttribute(
      "aria-label",
      this.text("内容を確認して有効化"),
    );
    acceptButton.addEventListener("click", () => {
      acceptButton.disabled = true;
      void this.handlers.onAcceptConsent().catch(() => {
        acceptButton.disabled = false;
        this.renderError(this.text("同意設定を保存できませんでした。"));
      });
    });

    this.card.replaceChildren(
      title,
      introduction,
      disclosures,
      acceptButton,
      this.preferenceControls(false),
    );
  }

  renderReady(): void {
    const title = this.heading("Geminiでこの検索に回答");
    const japaneseDetail =
      this.autoRun
        ? "自動モードでは、生成状態と回答をこのカード内で確認できます。"
        : "ボタンを押すと、現在の検索語をGeminiへ送信します。";
    const detail = textElement(
      "p",
      this.text(japaneseDetail),
      "detail",
    );
    const runButton = textElement(
      "button",
      this.text("Geminiで生成"),
    );
    runButton.type = "button";
    runButton.setAttribute("aria-label", this.text("Geminiで生成"));
    runButton.addEventListener("click", () => {
      runButton.disabled = true;
      this.renderStatus("queued");
      void this.handlers.onRunQuery().catch((error: unknown) => {
        const detail =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "不明なエラーです。";
        this.renderError(
          this.text("Geminiの処理を開始できませんでした。"),
          detail,
        );
      });
    });

    this.card.replaceChildren(
      title,
      detail,
      runButton,
      this.preferenceControls(),
    );
  }

  renderDuplicate(): void {
    const title = this.heading("Gemini Search Bridge");
    const detail = textElement(
      "p",
      this.text("同じ検索語は短時間の重複送信を防止しました。"),
      "detail",
    );
    const regenerateButton = textElement(
      "button",
      this.text("手動で再生成"),
    );
    regenerateButton.type = "button";
    regenerateButton.setAttribute(
      "aria-label",
      this.text("手動で再生成"),
    );
    regenerateButton.addEventListener("click", () => {
      regenerateButton.disabled = true;
      this.renderStatus("queued");
      void this.handlers.onRunQuery().catch((error: unknown) => {
        this.renderError(
          this.text("再生成できませんでした。"),
          error instanceof Error ? error.message.slice(0, 500) : undefined,
        );
      });
    });
    this.card.replaceChildren(
      title,
      detail,
      regenerateButton,
      this.preferenceControls(),
    );
  }

  renderStatus(
    status: JobStatus,
    detail?: string,
    surfaceIssue?: WorkerPopupIssue,
  ): void {
    if (ERROR_STATUSES.has(status)) {
      this.renderError(
        (this.language === "en" ? STATUS_LABELS_EN : STATUS_LABELS_JA)[status],
        detail,
        surfaceIssue === undefined &&
          status !== "rate_limited" &&
          status !== "manual_intervention",
        true,
        surfaceIssue !== undefined,
      );
      return;
    }

    const title = this.heading("Gemini Search Bridge");
    const statusRow = document.createElement("div");
    statusRow.className = "status";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    statusRow.append(
      dot,
      textElement(
        "p",
        (this.language === "en" ? STATUS_LABELS_EN : STATUS_LABELS_JA)[status],
      ),
    );

    const nodes: Node[] = [title, statusRow];

    if (detail) {
      nodes.push(textElement("p", this.text(detail), "detail"));
    }

    nodes.push(this.preferenceControls());
    this.card.replaceChildren(...nodes);
  }

  renderError(
    message: string,
    detail?: string,
    allowRetry = true,
    allowFallback = true,
    allowRecreate = false,
  ): void {
    const title = this.heading("Gemini Search Bridge");
    const statusRow = document.createElement("div");
    statusRow.className = "status error";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    statusRow.append(
      dot,
      textElement("p", `${this.text("エラー")}: ${message}`),
    );
    const retryButton = textElement("button", this.text("再試行"));
    retryButton.type = "button";
    retryButton.setAttribute("aria-label", this.text("再試行"));
    retryButton.addEventListener("click", () => {
      retryButton.disabled = true;
      this.renderStatus("queued");
      void this.handlers.onRunQuery().catch((error: unknown) => {
        this.renderError(
          this.text("再試行できませんでした。"),
          error instanceof Error ? error.message.slice(0, 500) : undefined,
        );
      });
    });

    const nodes: Node[] = [title, statusRow];

    if (detail) {
      nodes.push(textElement("p", this.text(detail), "detail"));
    }

    if (allowRecreate) {
      const recreateButton = textElement(
        "button",
        this.text("背面ウィンドウを再作成"),
      );
      recreateButton.type = "button";
      recreateButton.setAttribute(
        "aria-label",
        this.text("背面ウィンドウを再作成"),
      );
      recreateButton.addEventListener("click", () => {
        recreateButton.disabled = true;
        this.renderStatus("loading_gemini");
        void this.handlers.onRecreateWorker().catch(() => {
          recreateButton.disabled = false;
        });
      });
      nodes.push(recreateButton);
    }

    if (allowFallback) {
      const fallbackButton = textElement(
        "button",
        this.text("通常タブで続行"),
      );
      fallbackButton.type = "button";
      fallbackButton.className = "secondary";
      fallbackButton.setAttribute(
        "aria-label",
        this.text("通常タブで続行"),
      );
      fallbackButton.addEventListener("click", () => {
        fallbackButton.disabled = true;
        void this.handlers.onOpenFallback().catch(() => {
          fallbackButton.disabled = false;
        });
      });
      nodes.push(fallbackButton);
    }

    if (allowRetry) {
      nodes.push(retryButton);
    }

    nodes.push(this.preferenceControls());
    this.card.replaceChildren(...nodes);
  }

  renderStreaming(text: string, detail?: string): void {
    let preview = this.card.querySelector<HTMLElement>("[data-streaming-answer]");
    if (!preview || preview.dataset.language !== this.language) {
      this.renderStatus("generating");
      preview = document.createElement("div");
      preview.dataset.streamingAnswer = "true";
      preview.dataset.language = this.language;
      preview.className = "answer";
      preview.style.whiteSpace = "pre-wrap";
      preview.style.overflowWrap = "anywhere";
      preview.setAttribute("aria-live", "off");
      const hint = textElement("p", "", "detail");
      hint.dataset.streamingHint = "true";
      this.card.querySelector(".preferences")?.before(hint, preview);
    }
    preview.textContent = text;
    const hint = this.card.querySelector<HTMLElement>("[data-streaming-hint]");
    if (hint) hint.textContent = detail ?? "";
  }

  renderAnswer(answer: StructuredAnswer): void {
    const title = this.heading("Geminiによる回答");
    const nodes: Node[] = [title];

    if (answer.modelLabel) {
      nodes.push(
        textElement(
          "p",
          `${this.language === "en" ? "Model" : "モデル"}: ${answer.modelLabel}`,
          "detail",
        ),
      );
    }

    const answerDetails = document.createElement("details");
    answerDetails.className = "answer-details";
    answerDetails.open = true;
    const summary = textElement(
      "summary",
      this.text("回答を折りたたむ／展開する"),
    );
    const answerContainer = document.createElement("div");
    answerContainer.className = "answer";

    for (const block of answer.blocks) {
      answerContainer.append(this.renderAnswerBlock(block));
    }

    answerDetails.append(summary, answerContainer);

    const safeLinks = answer.links
      .map((link) => ({ ...link, url: sanitizeCardLink(link.url) }))
      .filter(
        (link): link is { label: string; url: string } => link.url !== null,
      );

    if (safeLinks.length > 0) {
      const sources = document.createElement("section");
      sources.className = "sources";
      sources.append(textElement("h3", this.text("出典")));
      const list = document.createElement("ul");

      for (const link of safeLinks) {
        const item = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.textContent = link.label;
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        item.append(anchor);
        list.append(item);
      }

      sources.append(list);
      answerDetails.append(sources);
    }

    nodes.push(answerDetails);

    const actions = document.createElement("div");
    actions.className = "answer-actions";
    const openGeminiLink = textElement(
      "a",
      this.text("Geminiで開く"),
    );
    openGeminiLink.href = "https://gemini.google.com/app";
    openGeminiLink.target = "_blank";
    openGeminiLink.rel = "noopener noreferrer";
    openGeminiLink.setAttribute("aria-label", this.text("Geminiで開く"));
    const copyButton = textElement("button", this.text("コピー"));
    copyButton.type = "button";
    copyButton.className = "secondary";
    copyButton.setAttribute("aria-label", this.text("コピー"));
    copyButton.addEventListener("click", () => {
      copyButton.disabled = true;
      void navigator.clipboard
        .writeText(answer.plainText)
        .then(() => {
          copyButton.textContent = this.text("コピーしました");
        })
        .catch(() => {
          copyButton.textContent = this.text("コピーできませんでした");
        })
        .finally(() => {
          window.setTimeout(() => {
            copyButton.textContent = this.text("コピー");
            copyButton.disabled = false;
          }, 1_500);
        });
    });

    const regenerateButton = textElement(
      "button",
      this.text("再生成"),
    );
    regenerateButton.type = "button";
    regenerateButton.setAttribute("aria-label", this.text("再生成"));
    regenerateButton.addEventListener("click", () => {
      regenerateButton.disabled = true;
      this.renderStatus("queued");
      void this.handlers.onRunQuery().catch((error: unknown) => {
        this.renderError(
          this.text("再生成できませんでした。"),
          error instanceof Error ? error.message.slice(0, 500) : undefined,
        );
      });
    });
    actions.append(openGeminiLink, copyButton, regenerateButton);
    nodes.push(actions);
    nodes.push(this.preferenceControls());
    this.card.replaceChildren(...nodes);
  }

  private renderAnswerBlock(block: AnswerBlock): HTMLElement {
    if (block.type === "paragraph") {
      return textElement("p", block.text);
    }

    if (block.type === "heading") {
      const heading =
        block.level === 1
          ? document.createElement("h3")
          : block.level === 2
            ? document.createElement("h4")
            : document.createElement("h5");
      heading.textContent = block.text;
      return heading;
    }

    if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");

      for (const text of block.items) {
        list.append(textElement("li", text));
      }

      return list;
    }

    if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = textElement("code", block.code);

      if (block.language) {
        code.setAttribute("data-language", block.language);
        pre.setAttribute(
          "aria-label",
          `${this.language === "en" ? "Code" : "コード"} (${block.language})`,
        );
      }

      pre.append(code);
      return pre;
    }

    return textElement("blockquote", block.text);
  }
}
