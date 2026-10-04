import { isAnswerBlock, sanitizeHttpUrl, type AnswerBlock, type StructuredAnswer } from "../../shared/answer-models";
import { sanitizeConversationUrl } from "../../shared/conversation-url";
import { translate } from "../../userscript/i18n";
import { getLanguage } from "../../userscript/preferences";

export interface SearchCardState {
  jobId?: string | undefined;
  status?: string;
  detail?: string;
  progressText?: string;
  answer?: StructuredAnswer;
  conversationUrl?: string | null;
  busy?: boolean;
  pipReady?: boolean;
  canRetry?: boolean;
}
export const sanitizeCardLink = sanitizeHttpUrl;

const CARD_CSS = `
  :host { display:block; margin:0 0 20px; max-width:760px; color:#243149;
    font-family:"Yu Gothic UI","Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif; }
  :host([data-floating="true"]) { position:fixed; right:16px; bottom:16px;
    z-index:2147483646; width:min(640px,calc(100vw - 32px)); max-height:75vh; overflow:auto; }
  * { box-sizing:border-box; }
  article { border:1px solid #D8E0EF; border-top:3px solid #415FC8;
    border-radius:8px; padding:18px 20px; background:white; }
  button,a { font:inherit; font-size:14px; }
  button { min-height:44px; padding:9px 16px; border:1px solid #415FC8;
    border-radius:6px; background:#415FC8; color:white; font-weight:600; cursor:pointer; }
  button:hover { background:#243149; }
  button:focus-visible,a:focus-visible { outline:3px solid #415FC8; outline-offset:3px; }
  [hidden] { display:none !important; }
  .output { margin-top:16px; }
  article[data-compact="true"] .output { margin-top:0; }
  button.owner.compact { display:block; min-height:32px; margin:12px 0 0 auto; padding:5px 10px;
    border-color:#D8E0EF; background:white; color:#677386; font-size:12px; font-weight:400; }
  button.owner.compact:hover { background:#F2F5FC; color:#243149; }
  .status { font-size:14px; font-weight:600; margin:0; }
  .detail { margin:6px 0 0; font-size:13px; line-height:1.6; }
  .answer { display:grid; gap:12px; margin-top:14px; overflow-wrap:anywhere;
    font-size:15px; line-height:1.8; }
  .answer p,.answer h3,.answer h4,.answer h5 { margin:0; }
  .answer h3 { font-size:19px; } .answer h4 { font-size:17px; } .answer h5 { font-size:15px; }
  .answer ul,.answer ol { margin:0; padding-left:24px; }
  .answer pre { margin:0; padding:12px; overflow:auto; background:#F2F5FC;
    border-radius:4px; font:13px/1.6 ui-monospace,Consolas,monospace; }
  .answer blockquote { margin:0; border-left:3px solid #D8E0EF; padding-left:12px; }
  .streaming { white-space:pre-wrap; }
  .preview { position:relative; max-height:min(210px,27.5vh); overflow:hidden; }
  .preview[data-expanded="true"] { max-height:none; overflow:visible; }
  .preview[data-clipped="true"]::after { content:""; position:absolute; inset:auto 0 0;
    height:32px; background:linear-gradient(transparent,white); pointer-events:none; }
  .preview[data-clipped="true"] .sources { visibility:hidden; }
  button.expand { display:block; width:100%; margin-top:12px; border-color:#D8E0EF;
    border-radius:24px; background:white; color:#243149; }
  button.expand:hover { background:#F2F5FC; }
  .sources { margin-top:18px; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
  .sources ul { margin:6px 0 0; padding-left:20px; }
  a { color:#415FC8; text-underline-offset:3px; }
  .conversation { display:flex; align-items:center; justify-content:center; width:100%; min-height:44px;
    padding:9px 16px; margin-top:12px; border:1px solid #415FC8; border-radius:6px;
    background:#F2F5FC; font-weight:600; text-align:center; text-decoration:none; }
  .conversation:hover { background:#E8EEFA; }
  button.retry { display:block; margin-top:12px; background:white; color:#415FC8; }
  @media (max-width:480px) { article { padding:14px; } .answer { font-size:14px; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
`;

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function externalLink(label: string, url: string): HTMLAnchorElement {
  const anchor = textElement("a", label);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}
function renderBlock(block: AnswerBlock): HTMLElement {
  if (block.type === "paragraph") return textElement("p", block.text);
  if (block.type === "quote") return textElement("blockquote", block.text);
  if (block.type === "heading") return textElement(block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5", block.text);
  if (block.type === "code") {
    const pre = document.createElement("pre");
    pre.append(textElement("code", block.code));
    return pre;
  }
  const list = document.createElement(block.ordered ? "ol" : "ul");
  for (const item of block.items) list.append(textElement("li", item));
  return list;
}

export class SearchCardView {
  readonly host: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly output: HTMLDivElement;
  private lastState = "";
  private currentJob: string | undefined;
  private expanded = false;
  private compact = false;
  private previewObserver?: ResizeObserver;

  constructor(onOpen: () => void, private readonly onRetry?: () => void) {
    this.host = document.createElement("div");
    this.host.id = "gemini-search-bridge-root";
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = textElement("style", CARD_CSS);
    const card = this.card = document.createElement("article");
    card.lang = getLanguage();
    card.setAttribute("aria-label", "Gemini");
    this.button = textElement("button", translate("Geminiウィンドウを開く"), "owner");
    this.button.type = "button";
    this.button.addEventListener("click", onOpen);
    this.output = document.createElement("div");
    this.output.className = "output";
    this.output.hidden = true;
    card.append(this.button, this.output);
    shadow.append(style, card);
  }

  mount(): void {
    if (this.host.isConnected) return;
    const results = document.querySelector("#rso");
    if (results) {
      this.host.dataset.floating = "false";
      results.prepend(this.host);
      return;
    }
    const anchor = document.querySelector("#rso, #search, #center_col, [role='main']");
    if (anchor?.parentElement) {
      this.host.dataset.floating = "false";
      anchor.before(this.host);
    } else {
      this.host.dataset.floating = "true";
      document.body.append(this.host);
    }
  }
  remove(): void { this.previewObserver?.disconnect(); this.host.remove(); }

  render(state: SearchCardState = {}): void {
    const signature = JSON.stringify([getLanguage(), state]);
    if (signature === this.lastState) return;
    this.lastState = signature;
    this.card.lang = getLanguage();
    this.button.textContent = translate("Geminiウィンドウを開く");
    const jobId = state.jobId ?? state.answer?.jobId;
    if (jobId !== this.currentJob || !state.answer && !state.progressText) this.expanded = false;
    this.currentJob = jobId;
    this.previewObserver?.disconnect();
    const compact = state.pipReady === true ||
      !!(state.answer?.blocks.some(isAnswerBlock) || state.progressText?.trim()) && !state.detail && !state.canRetry;
    if (compact !== this.compact) {
      this.compact = compact;
      this.card.dataset.compact = String(compact);
      this.button.className = compact ? "owner compact" : "owner";
      this.card.replaceChildren(...compact ? [this.output, this.button] : [this.button, this.output]);
    }
    const nodes: Node[] = [];
    let preview: HTMLDivElement | undefined;
    let body: HTMLDivElement | undefined;
    let sources: HTMLElement | undefined;
    let expander: HTMLButtonElement | undefined;
    let conversation: HTMLAnchorElement | undefined;
    // Opening the owner remains available while it is generating.
    this.button.setAttribute("aria-busy", String(state.busy === true));
    if (state.status) {
      const status = textElement("p", translate(state.status), "status");
      status.setAttribute("role", "status");
      nodes.push(status);
    }
    if (state.detail) nodes.push(textElement("p", translate(state.detail), "detail"));
    if (state.canRetry && this.onRetry) {
      const retry = textElement("button", translate("この検索を再送信"), "retry");
      retry.type = "button";
      retry.addEventListener("click", this.onRetry);
      nodes.push(retry);
    }
    if (state.answer) {
      preview = document.createElement("div");
      body = document.createElement("div");
      const answer = document.createElement("div");
      answer.className = "answer";
      for (const block of state.answer.blocks) if (isAnswerBlock(block)) answer.append(renderBlock(block));
      body.append(answer);
      sources = document.createElement("section");
      sources.className = "sources";
      const list = document.createElement("ul");
      for (const link of state.answer.links) {
        const url = sanitizeCardLink(link.url);
        if (!url) continue;
        const item = document.createElement("li");
        item.append(externalLink(link.label, url));
        list.append(item);
      }
      if (list.childElementCount) {
        sources.append(textElement("p", translate("出典")), list);
        body.append(sources);
      }
    } else if (state.progressText) {
      preview = document.createElement("div");
      body = document.createElement("div");
      const streaming = textElement("div", state.progressText, "answer streaming");
      streaming.setAttribute("aria-live", "off");
      body.append(streaming);
    }
    if (preview && body) {
      preview.className = "preview";
      preview.id = "gemini-answer-preview";
      preview.append(body);
      expander = textElement("button", translate("もっと見る"), "expand");
      expander.type = "button";
      expander.hidden = true;
      expander.setAttribute("aria-controls", preview.id);
      nodes.push(preview);
    }
    const url = sanitizeConversationUrl(state.conversationUrl);
    if (url) {
      conversation = externalLink(translate("Geminiを開いて会話を続ける"), url);
      conversation.className = "conversation";
      nodes.push(conversation);
    }
    if (expander) nodes.push(expander);
    this.output.replaceChildren(...nodes);
    this.output.hidden = nodes.length === 0;
    if (preview && body && expander) {
      const viewport = preview;
      const content = body;
      const toggle = expander;
      const updatePreview = (): void => {
        // The clipping box includes the answer's leading margin in its scroll extent.
        const overflowing = viewport.scrollHeight > Math.min(210, window.innerHeight * 0.275) + 1;
        const clipped = overflowing && !this.expanded;
        const expanded = String(this.expanded);
        const label = translate(this.expanded ? "折りたたむ" : "もっと見る");
        if (viewport.dataset.expanded !== expanded) viewport.dataset.expanded = expanded;
        if (viewport.dataset.clipped !== String(clipped)) viewport.dataset.clipped = String(clipped);
        if (sources && sources.inert !== clipped) sources.inert = clipped;
        if (conversation && conversation.hidden !== clipped) conversation.hidden = clipped;
        if (toggle.hidden === overflowing) toggle.hidden = !overflowing;
        if (toggle.textContent !== label) toggle.textContent = label;
        if (toggle.getAttribute("aria-expanded") !== expanded) toggle.setAttribute("aria-expanded", expanded);
      };
      toggle.addEventListener("click", () => { this.expanded = !this.expanded; updatePreview(); });
      if (typeof ResizeObserver !== "undefined") {
        this.previewObserver = new ResizeObserver(updatePreview);
        this.previewObserver.observe(content);
        this.previewObserver.observe(viewport);
      }
      updatePreview();
    }
  }
}
