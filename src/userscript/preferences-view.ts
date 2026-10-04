import { localized, translate } from "./i18n";
import { DEFAULT_TEMPLATES, getLanguage, readPreferences, resolveLanguage, savePreferences, type LanguageSetting } from "./preferences";

const STYLE = `
:host{all:initial;font:14px/1.6 system-ui,-apple-system,"Yu Gothic UI",Meiryo,sans-serif;color:#243149}
*{box-sizing:border-box}[hidden]{display:none!important}
.settings{position:fixed;inset:24px 24px auto auto;z-index:2147483647;width:min(540px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;background:white;border:1px solid #D8E0EF;border-radius:12px;padding:24px;box-shadow:0 12px 40px #24314926}
header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{font-size:20px;line-height:1.3;margin:0}p{margin:12px 0;color:#5D6C85}
label{display:block;margin-top:20px;font-weight:600}.default{display:flex;gap:10px;align-items:start;font-weight:400}input{margin:5px 0 0;accent-color:#415FC8}
select,textarea,button{font:inherit}select,textarea{display:block;width:100%;margin-top:8px;border:1px solid #A9B7D0;border-radius:6px;padding:9px;color:#243149;background:white}
textarea{min-height:140px;resize:vertical;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,Consolas,monospace;caret-color:#415FC8}textarea:disabled{background:#F2F5FC;color:#5D6C85}
button{cursor:pointer;min-height:40px;padding:8px 14px;border:1px solid #D8E0EF;border-radius:6px;background:white;color:#415FC8}.save{background:#415FC8;border-color:#415FC8;color:white}button:hover{filter:brightness(.94)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #415FC8;outline-offset:3px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.error{color:#A32B31}.message{margin-bottom:0}code{color:#243149}::selection{background:#D8E0EF;color:#243149}
@media(max-width:480px){.settings{inset:12px 12px auto auto;width:calc(100vw - 24px);max-height:calc(100vh - 24px);padding:18px}}
`;

let current: PreferencesView | undefined;

function focusedElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

/** A nonmodal, script-owned region: it never changes Gemini's application DOM. */
class PreferencesView {
  readonly host = document.createElement("div");
  private readonly panel = document.createElement("section");
  private readonly language = document.createElement("select");
  private readonly useDefault = document.createElement("input");
  private readonly template = document.createElement("textarea");
  private readonly message = document.createElement("p");
  private readonly labels: (() => void)[] = [];
  private customDraft: string | null = null;
  private messageText = "";
  private readonly previousFocus = focusedElement();
  private readonly refresh = (): void => {
    this.panel.lang = getLanguage();
    for (const update of this.labels) update();
    this.updateTemplate();
    this.message.textContent = this.messageText === "保存しました。次の検索から適用されます。" ? localized(this.messageText, "Saved. Changes apply to future searches.") : translate(this.messageText);
  };

  constructor() {
    this.host.id = "gemini-search-bridge-preferences";
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = STYLE;
    this.panel.className = "settings";
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-labelledby", "gsb-settings-title");
    const heading = this.text("h2", "ユーザースクリプト設定", "Userscript settings"); heading.id = "gsb-settings-title";
    const close = this.text("button", "閉じる", "Close"); close.type = "button";
    close.addEventListener("click", () => this.close());
    const header = document.createElement("header"); header.append(heading, close);
    const intro = this.text("p", "変更は次の検索から適用されます。現在の検索は再送信しません。", "Changes apply to future searches. This does not resend your current search.");
    const form = document.createElement("form"); form.noValidate = true;
    const languageLabel = this.text("label", "表示言語", "Display language");
    this.language.id = "gsb-language"; languageLabel.htmlFor = this.language.id;
    for (const [value, ja, en] of [["auto", "ブラウザーに合わせる", "Follow browser language"], ["ja", "日本語", "日本語"], ["en", "English", "English"]]) {
      const option = this.text("option", ja!, en!); option.value = value!; this.language.append(option);
    }
    this.language.addEventListener("change", () => this.updateTemplate());
    const defaultLabel = document.createElement("label"); defaultLabel.className = "default";
    this.useDefault.type = "checkbox";
    defaultLabel.append(this.useDefault, this.text("span", "言語に合わせた既定のプロンプトを使う", "Use the default prompt for the selected language"));
    const templateLabel = this.text("label", "プロンプトテンプレート", "Prompt template");
    this.template.id = "gsb-template"; templateLabel.htmlFor = this.template.id;
    this.template.maxLength = 4096;
    this.template.setAttribute("aria-describedby", "gsb-template-help gsb-settings-message");
    this.template.addEventListener("input", () => { this.customDraft = this.template.value; });
    this.useDefault.addEventListener("change", () => {
      if (this.useDefault.checked || this.customDraft === null) this.customDraft = this.template.value;
      this.updateTemplate();
    });
    const help = this.text("p", "%%prompt%% を検索語に置き換えます。例: ウェブ検索し参照を明示: %%prompt%%", "%%prompt%% is replaced with the search query. Example: Search the web and cite your sources: %%prompt%%");
    help.id = "gsb-template-help";
    const save = this.text("button", "保存", "Save"); save.type = "submit"; save.className = "save";
    const reset = this.text("button", "既定に戻す", "Reset to defaults"); reset.type = "button";
    reset.addEventListener("click", () => {
      this.language.value = "auto"; this.useDefault.checked = true; this.customDraft = null;
      this.updateTemplate(); this.messageText = ""; this.message.textContent = ""; this.template.setAttribute("aria-invalid", "false");
    });
    const actions = document.createElement("div"); actions.className = "actions"; actions.append(save, reset);
    this.message.id = "gsb-settings-message"; this.message.className = "message";
    this.message.setAttribute("role", "status"); this.message.setAttribute("aria-live", "polite");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        savePreferences({ language: this.language.value as LanguageSetting, promptTemplate: this.useDefault.checked ? null : this.template.value });
        this.messageText = "保存しました。次の検索から適用されます。";
        this.message.className = "message"; this.template.setAttribute("aria-invalid", "false");
        window.dispatchEvent(new Event("gsb-preferences-changed"));
        this.refresh();
      } catch (error) {
        this.messageText = error instanceof Error ? error.message : String(error);
        this.message.className = "message error"; this.template.setAttribute("aria-invalid", "true");
        this.message.textContent = translate(this.messageText); this.template.focus();
      }
    });
    form.append(languageLabel, this.language, defaultLabel, templateLabel, this.template, help, actions, this.message);
    this.panel.append(header, intro, form); root.append(style, this.panel); document.body.append(this.host);
    const preferences = readPreferences();
    this.language.value = preferences.language; this.useDefault.checked = preferences.promptTemplate === null;
    this.customDraft = preferences.promptTemplate;
    window.addEventListener("gsb-preferences-changed", this.refresh);
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    this.refresh(); this.language.focus();
  }

  private text<K extends keyof HTMLElementTagNameMap>(tag: K, ja: string, en: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    this.labels.push(() => { node.textContent = localized(ja, en); });
    return node;
  }
  private updateTemplate(): void {
    const language = resolveLanguage(this.language.value as LanguageSetting, navigator.language);
    this.template.disabled = this.useDefault.checked;
    if (this.useDefault.checked) this.template.value = DEFAULT_TEMPLATES[language];
    else if (this.customDraft !== null && this.template.value !== this.customDraft) this.template.value = this.customDraft;
    this.template.placeholder = DEFAULT_TEMPLATES[language];
  }
  focus(): void { this.language.focus(); }
  private close(): void {
    window.removeEventListener("gsb-preferences-changed", this.refresh); this.host.remove(); current = undefined;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) this.previousFocus.focus();
  }
}

export function openPreferences(): void {
  if (current?.host.isConnected) { current.focus(); return; }
  current = new PreferencesView();
}
