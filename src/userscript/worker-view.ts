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
.brand{display:flex;align-items:center;gap:10px;padding-right:140px;font-size:13px;font-weight:650;letter-spacing:.04em}
.mark{display:grid;place-items:center;width:30px;height:30px;background:#415FC8;color:white;border-radius:8px;font-size:17px}
.layout{flex:1;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,1fr);gap:clamp(30px,7vw,90px);align-items:center;padding:clamp(32px,8vh,80px) 0}
.eyebrow{margin:0 0 18px;color:#415FC8;font-size:13px;font-weight:700;letter-spacing:.1em}
h1{max-width:12em;margin:0 0 24px;font-size:clamp(32px,4.5vw,56px);line-height:1.3;font-weight:750;letter-spacing:-.045em;text-wrap:balance}
.intro{max-width:34em;margin:0 0 24px;font-size:16px}
.primary{width:100%;max-width:420px;min-height:56px;padding:14px 22px;background:#415FC8;border:1px solid #415FC8;border-radius:12px;color:white;font-size:15px;font-weight:700;box-shadow:0 6px 18px #415FC81a;transition:background .15s ease}
.primary:hover:not(:disabled){background:#334DAF}.primary:disabled{cursor:default;background:#D8E0EF;border-color:#D8E0EF;color:#46556E;box-shadow:none}
.paused{margin:12px 0 0;color:#5D6C85;font-size:13px}
.status{margin:18px 0 0;padding-left:12px;border-left:3px solid #415FC8;overflow-wrap:anywhere;font-size:14px}
.ready{margin:18px 0 0;padding:16px;background:white;border:1px solid #D8E0EF;border-radius:12px;font-size:14px}
.return{margin:12px 0 0;color:#5D6C85;font-size:14px}
.side{padding:28px;background:white;border:1px solid #D8E0EF;border-radius:20px;box-shadow:0 12px 36px #24314908}
.preview{overflow:hidden;border:1px solid #D8E0EF;border-radius:12px;background:#F2F5FC}
.preview-title{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #D8E0EF;background:white;font-size:12px;font-weight:650}
.pip-tag{font-size:11px;color:#415FC8;letter-spacing:.06em}
.preview-body{padding:22px 18px}.signal{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:650}
.dot{width:7px;height:7px;border-radius:50%;background:#7A8AA8}.side[data-ready="true"] .dot{background:#287C75}
.preview-note{margin:10px 0 0;color:#5D6C85;font-size:12px}
.steps{margin:24px 0 0;padding:0;list-style:none}.steps li{display:flex;gap:12px;font-size:14px}.steps li+li{margin-top:16px}
.step{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#F2F5FC;color:#415FC8;font-size:12px;font-weight:700}
.steps strong{display:block;font-weight:650}.steps span:last-child{color:#5D6C85;font-size:12px}
.consent{max-width:42em;margin:0 0 20px;color:#5D6C85;font-size:12px}
.footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding-top:20px}
.plain{padding:8px 0;border:0;background:transparent;color:#415FC8;font-size:13px;text-decoration:underline;text-underline-offset:4px}.plain:hover{color:#243149}
.inspect{position:fixed;top:16px;right:20px;padding:8px 12px;border-radius:8px;background:#F2F5FC;z-index:1}.close{color:#5D6C85}.pill{position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:11px 16px;background:white;border:1px solid #D8E0EF;border-radius:999px;box-shadow:0 4px 20px #24314918;color:#243149;font-size:13px;font-weight:650}.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:#415FC8}
@media(max-width:760px){.layout{grid-template-columns:1fr;gap:28px}.side{padding:22px}.screen{padding:24px}.layout{padding:38px 0 28px}.primary{max-width:none}h1{font-size:clamp(30px,7.5vw,44px)}}
@media(max-height:600px) and (min-width:761px){.layout{padding:28px 0}.screen{padding:24px 40px}h1{font-size:36px}.side{padding:20px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export class WorkerView {
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
    const mark = this.element("span", "mark", "↗");
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
    main.append(this.element("p", "eyebrow", "GEMINI側の準備"), heading, intro, consent, this.openButton, this.paused, this.status, this.ready, returnSearch);
    this.side.className = "side";
    const preview = this.element("div", "preview");
    preview.setAttribute("aria-hidden", "true");
    const previewTitle = this.element("div", "preview-title");
    previewTitle.append(this.element("span", "", "Gemini Search Bridge"), this.element("span", "pip-tag", "PiP"));
    const previewBody = this.element("div", "preview-body");
    const signalRow = this.element("p", "signal");
    signalRow.append(this.element("span", "dot"), this.signal);
    previewBody.append(signalRow, this.element("p", "preview-note", "検索と並べて使える、Geminiの小窓。"));
    preview.append(previewTitle, previewBody);
    const steps = this.element("ol", "steps");
    for (const [title, note] of [
      ["PiP小窓を開く", "この画面のボタンを直接押します。"],
      ["Google検索に戻る", "小窓とGemini本体は開いたまま使います。"],
    ]) {
      const row = document.createElement("li");
      const copy = document.createElement("div");
      copy.append(this.element("strong", "", title), this.element("span", "", note));
      row.append(this.element("span", "step", String(steps.children.length + 1)), copy);
      steps.append(row);
    }
    this.side.append(preview, steps);
    layout.append(main, this.side);
    const footer = this.element("div", "footer");
    this.inspectButton.type = "button";
    this.inspectButton.className = "plain inspect";
    this.inspectButton.textContent = "Gemini画面を確認";
    this.inspectButton.addEventListener("click", () => { actions.onInspect?.(); this.revealGemini(); });
    this.closeButton.type = "button";
    this.closeButton.className = "plain close";
    this.closeButton.textContent = "PiPを閉じて自動送信を停止";
    this.closeButton.addEventListener("click", () => actions.onClosePip());
    footer.append(this.inspectButton, this.closeButton);
    shell.append(brand, layout, footer);
    this.screen.append(shell);
    this.screen.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); actions.onInspect?.(); this.revealGemini(); }
    });
    this.pill.type = "button";
    this.pill.className = "pill";
    this.pill.textContent = "小窓の設定を開く";
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

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  update(state: WorkerViewState): void {
    this.openButton.disabled = !state.supported || state.pipReady;
    this.openButton.textContent = state.pipReady ? "PiP小窓は表示中です" : "PiPを開いて自動送信を開始";
    this.closeButton.hidden = !state.pipReady;
    this.ready.hidden = !state.pipReady;
    this.paused.hidden = state.pipReady;
    this.paused.textContent = state.supported ? "PiP小窓を開くまで、自動送信は停止しています。" : "このブラウザーではPiPを利用できないため、自動送信は停止しています。Chromeで開いてください。";
    this.side.dataset.ready = String(state.pipReady);
    this.signal.textContent = state.pipReady ? "小窓を表示しています" : "小窓の開始を待っています";
    this.status.textContent = state.status ?? "";
    this.status.hidden = !state.status;
  }

  revealGemini(): void {
    this.screen.hidden = true;
    this.pill.hidden = false;
    this.pill.focus();
  }
}
