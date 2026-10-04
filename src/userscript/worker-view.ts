import { GEMINI_ICON } from "../shared/gemini-icon";
import { localized, translate } from "./i18n";
import { getLanguage } from "./preferences";
import { openPreferences } from "./preferences-view";

interface WorkerViewActions {
  onOpenPip: () => void;
  onClosePip: () => void;
  onInspect?: () => void;
}

interface WorkerViewState {
  pipReady: boolean;
  supported: boolean;
  status?: string;
}

const STYLE = `
:host{all:initial;font-family:system-ui,-apple-system,"Yu Gothic UI",Meiryo,sans-serif;color:#243149;line-height:1.65}
*{box-sizing:border-box}[hidden]{display:none!important}
button{font:inherit;cursor:pointer;touch-action:manipulation}
button:focus-visible{outline:3px solid #415FC8;outline-offset:5px}
.screen{position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#F2F5FC;padding:clamp(24px,5vw,64px)}
.shell{max-width:1080px;min-height:100%;margin:0 auto;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:650;letter-spacing:.04em}
.mark{width:30px;height:30px;object-fit:contain}
.layout{flex:1;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,1fr);gap:clamp(30px,7vw,90px);align-items:center;padding:clamp(32px,8vh,80px) 0}
h1{max-width:15em;margin:0 0 24px;font-size:clamp(32px,4.5vw,56px);line-height:1.3;font-weight:750;letter-spacing:-.03em;text-wrap:balance}
.intro{max-width:34em;margin:0 0 24px;font-size:16px}
.primary{width:100%;max-width:420px;min-height:56px;padding:14px 22px;background:#415FC8;border:1px solid #415FC8;border-radius:12px;color:white;font-size:15px;font-weight:700;box-shadow:0 6px 18px #415FC81a;transition:background .15s ease}
.primary:hover:not(:disabled){background:#334DAF}.primary:disabled{cursor:default;background:#D8E0EF;border-color:#D8E0EF;color:#46556E;box-shadow:none}
.paused{margin:12px 0 0;color:#5D6C85;font-size:13px}
.status{margin:18px 0 0;overflow-wrap:anywhere;font-size:14px}
.ready{margin:18px 0 0;padding:16px;background:white;border:1px solid #D8E0EF;border-radius:12px;font-size:14px}
.return{margin:12px 0 0;color:#5D6C85;font-size:14px}
.side{padding:0;min-width:0}
.signal{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:650}
.dot{width:7px;height:7px;border-radius:50%;background:#7A8AA8}.side[data-ready="true"] .dot{background:#287C75}
.steps{margin:0;padding:0;list-style:none}.steps li{display:flex;gap:12px;font-size:14px;align-items:flex-start}.steps li+li{margin-top:20px}
.step{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#F2F5FC;color:#415FC8;font-size:12px;font-weight:700}
.steps strong{display:block;font-weight:650}.steps span:last-child{color:#5D6C85;font-size:12px}
.step-copy{min-width:0;flex:1}.steps .step{background:white;border:1px solid #D8E0EF}.flow-note{display:block;margin:5px 0 10px}
.mini{overflow:hidden;background:white;border:1px solid #D8E0EF;border-radius:8px;min-width:0}.mini-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#E8EEFA;border-bottom:1px solid #D8E0EF;color:#46556E;font-size:11px}.mini-head img{width:15px;height:15px;vertical-align:middle;margin-inline-end:5px}.mini-body{padding:12px;color:#5D6C85;font-size:12px}
.mini-button{display:inline-block;padding:4px 9px;border-radius:4px;background:#415FC8;color:white;font-weight:600}.mini-answer{padding-top:8px;color:#243149}.mini-search{border:1px solid #D8E0EF;border-radius:20px;padding:5px 10px;color:#5D6C85}.window-controls{display:flex;gap:12px;flex:none}.window-controls i{display:block;position:relative;width:10px;height:10px}.minimize::after{content:"";position:absolute;left:0;right:0;bottom:2px;border-bottom:1px solid currentColor}.window-close::before,.window-close::after{content:"";position:absolute;left:4px;top:0;height:11px;border-left:1px solid currentColor;transform:rotate(45deg)}.window-close::after{transform:rotate(-45deg)}
.policy{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.policy div{font-size:12px;line-height:1.5}.policy b{display:block;font-size:13px}.policy-ok{color:#216C62}.policy-no{color:#A32B31}.policy-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid currentColor;border-radius:5px;margin-bottom:5px}.policy-icon i{position:relative;width:11px;height:11px}.mini-caption{padding:0 12px 12px;color:#415FC8;font-size:11px}.mini-pip{border-color:#415FC8}.mini-pip .mini-head{background:#E8EEFA}.pip-caption{font-weight:600}
.consent{max-width:42em;margin:0 0 20px;color:#5D6C85;font-size:12px}
.footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding-top:20px}
.plain{padding:8px 0;border:0;background:transparent;color:#415FC8;font-size:13px;text-decoration:underline;text-underline-offset:4px}.plain:hover{color:#243149}
.close{color:#5D6C85}.pill{position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:11px 16px;background:white;border:1px solid #D8E0EF;border-radius:999px;box-shadow:0 4px 20px #24314918;color:#243149;font-size:13px;font-weight:650}.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:#415FC8}
@media(max-width:760px){.layout{grid-template-columns:1fr;gap:28px}.screen{padding:24px}.layout{padding:38px 0 28px}.primary{max-width:none}h1{font-size:clamp(30px,7.5vw,44px)}}
@media(max-height:600px) and (min-width:761px){.layout{padding:28px 0}.screen{padding:24px 40px}h1{font-size:36px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export class WorkerView {
  private readonly labels: (() => void)[] = [];
  private readonly host = document.createElement("div");
  private readonly screen = document.createElement("section");
  private readonly openButton = document.createElement("button");
  private readonly closeButton = document.createElement("button");
  private readonly inspectButton = document.createElement("button");
  private readonly pill = document.createElement("button");
  private readonly status = document.createElement("p");
  private readonly ready = document.createElement("p");
  private readonly paused = document.createElement("p");
  private readonly side = document.createElement("aside");
  private readonly signal = document.createElement("span");

  constructor(actions: WorkerViewActions) {
    this.host.id = "gemini-search-bridge-worker-view";
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.screen.className = "screen";
    this.screen.setAttribute("role", "region");
    this.screen.setAttribute("aria-labelledby", "gsb-worker-heading");
    const shell = this.element("div", "shell");
    const brand = this.element("div", "brand");
    const mark = this.element("img", "mark");
    mark.setAttribute("referrerpolicy", "no-referrer");
    mark.src = GEMINI_ICON; mark.alt = "";
    mark.setAttribute("aria-hidden", "true");
    brand.append(mark, this.element("span", "", "Gemini Search Bridge"));
    const layout = this.element("div", "layout");
    const main = this.element("div", "content");
    const heading = this.element("h1", "", "小窓を開いて、検索に戻る。");
    heading.id = "gsb-worker-heading";
    const intro = this.element("p", "intro", "Geminiの回答をGoogle検索に表示します。最初に、この画面からPiP小窓を開いてください。");
    const consent = this.element("p", "consent", "ボタンを押すと、Google検索の検索語をGeminiへ自動送信することに同意します。送信には、ログイン中のGoogleアカウントのGemini画面を使います。会話はGeminiの履歴設定に従って保存され、ご利用プランの制限が適用されます。APIキーは不要です。");
    this.openButton.type = "button";
    this.openButton.className = "primary";
    this.openButton.addEventListener("click", () => actions.onOpenPip());
    this.paused.className = "paused";
    this.status.className = "status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.ready.className = "ready";
    this.ready.textContent = "PiP小窓が表示されている間は、このウィンドウを最小化できます。閉じないでください。";
    const returnSearch = this.element("p", "return", "小窓を開いたら、Google検索のタブに戻って検索してください。回答は検索カードに表示されます。");
    main.append(heading, intro, consent, this.openButton, this.paused, this.status, this.ready, returnSearch);
    this.side.className = "side";
    const steps = this.element("ol", "steps");
    const stepData = [
      ["PiP小窓を開く", "Open the PiP companion", "この画面のボタンを直接押します。", "Click the button on this page."],
      ["小窓は表示したまま", "Keep the companion visible", "常に手前に表示される小窓が、回答を取得し続けます。", "The always-on-top companion keeps answer capture running."],
      ["Google検索に戻る", "Return to Google Search", "検索すると、回答が検索カードに届きます。", "Search as usual. Gemini answers appear in the search card."],
    ];
    for (const [index, [title, english, note, englishNote]] of stepData.entries()) {
      const row = document.createElement("li");
      const copy = this.element("div", "step-copy");
      copy.append(this.element("strong", "", title!, english!), this.element("span", "flow-note", note!, englishNote!));
      const mini = this.element("div", index === 1 ? "mini mini-pip" : "mini");
      mini.setAttribute("aria-hidden", "true");
      const miniHead = this.element("div", "mini-head");
      const miniTitle = this.element("span", "", index === 2 ? "Google Search" : index === 1 ? "PiP · Gemini" : "Gemini");
      const controls = this.element("span", "window-controls");
      controls.append(this.element("i", "minimize"), this.element("i", "window-close"));
      miniHead.append(miniTitle, controls);
      const miniBody = this.element("div", "mini-body");
      if (index === 0) {
        miniBody.append(this.element("span", "mini-button", "PiP小窓を開く", "Open PiP"));
        const policy = this.element("div", "policy");
        for (const [css, symbol, ja, en] of [["policy-ok", "minimize", "最小化 OK", "Minimize: OK"], ["policy-no", "window-close", "閉じる NG", "Close: No"]]) {
          const item = this.element("div", css!); const icon = this.element("span", "policy-icon");
          icon.append(this.element("i", symbol!)); icon.setAttribute("aria-hidden", "true");
          item.append(icon, this.element("b", "", ja!, en!)); policy.append(item);
        }
        miniBody.append(policy);
      } else if (index === 1) {
        const signalRow = this.element("p", "signal"); signalRow.append(this.element("span", "dot"), this.signal);
        miniBody.append(signalRow, this.element("p", "mini-answer", "回答を取得 → 検索カードへ", "Capture answer → search card"));
      } else {
        miniBody.append(this.element("div", "mini-search", "検索語を入力", "Enter a search query"), this.element("div", "mini-answer", "Geminiの回答", "Gemini answer"));
      }
      mini.append(miniHead, miniBody);
      if (index === 0) mini.append(this.element("div", "mini-caption", "PiPが表示中のときだけ最小化できます。", "Minimize only while PiP is visible."));
      if (index === 1) mini.append(this.element("div", "mini-caption pip-caption", "この小窓は閉じずに、画面のすみへ。", "Keep this companion open in a screen corner."));
      copy.append(mini);
      row.append(this.element("span", "step", String(index + 1)), copy);
      steps.append(row);
    }
    this.side.append(steps);
    layout.append(main, this.side);
    const footer = this.element("div", "footer");
    this.inspectButton.type = "button";
    this.inspectButton.className = "plain inspect";
    this.bind(this.inspectButton, "Gemini画面を確認");
    this.inspectButton.addEventListener("click", () => { actions.onInspect?.(); this.revealGemini(); });
    this.closeButton.type = "button";
    this.closeButton.className = "plain close";
    this.bind(this.closeButton, "PiPを閉じて自動送信を停止");
    this.closeButton.addEventListener("click", () => actions.onClosePip());
    const settings = this.element("button", "plain preferences", "言語・プロンプト設定", "Language and prompt settings");
    settings.type = "button"; settings.addEventListener("click", openPreferences);
    footer.append(this.inspectButton, settings, this.closeButton);
    shell.append(brand, layout, footer);
    this.screen.append(shell);
    this.screen.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); actions.onInspect?.(); this.revealGemini(); }
    });
    this.pill.type = "button";
    this.pill.className = "pill";
    this.bind(this.pill, "小窓の設定を開く");
    this.pill.hidden = true;
    this.pill.addEventListener("click", () => {
      this.screen.hidden = false;
      this.pill.hidden = true;
      (this.openButton.disabled ? this.inspectButton : this.openButton).focus();
    });
    root.append(style, this.screen, this.pill);
    document.body.append(this.host);
    this.update({ pipReady: false, supported: false });
  }

  private bind(element: HTMLElement, text: string, english?: string): void {
    const update = (): void => { element.textContent = english === undefined ? translate(text) : localized(text, english); };
    this.labels.push(update); update();
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, english?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) this.bind(element, text, english);
    return element;
  }

  update(state: WorkerViewState): void {
    this.screen.lang = getLanguage();
    for (const update of this.labels) update();
    this.ready.textContent = translate("PiP小窓が表示されている間は、このウィンドウを最小化できます。閉じないでください。");
    this.openButton.disabled = !state.supported || state.pipReady;
    this.openButton.textContent = translate(state.pipReady ? "PiP小窓は表示中です" : "PiPを開いて自動送信を開始");
    this.closeButton.hidden = !state.pipReady;
    this.ready.hidden = !state.pipReady;
    this.paused.hidden = state.pipReady;
    this.paused.textContent = translate(state.supported ? "PiP小窓を開くまで、自動送信は停止しています。" : "このブラウザーではPiPを利用できないため、自動送信は停止しています。Chromeで開いてください。");
    this.side.dataset.ready = String(state.pipReady);
    this.signal.textContent = translate(state.pipReady ? "小窓を表示しています" : "小窓の開始を待っています");
    this.status.textContent = translate(state.status ?? "");
    this.status.hidden = !state.status;
  }

  revealGemini(): void {
    this.screen.hidden = true;
    this.pill.hidden = false;
    this.pill.focus();
  }
}
