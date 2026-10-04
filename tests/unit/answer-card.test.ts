import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SearchCardView, sanitizeCardLink } from "../../src/content/google/card-view";
import type { StructuredAnswer } from "../../src/shared/answer-models";

let measuredHeight = 200;
let observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  className = "";
  id = "";
  href = "";
  target = "";
  rel = "";
  type = "";
  lang = "";
  hidden = false;
  inert = false;
  open = false;
  shadowRoot: ElementStub | null = null;
  measuredScrollHeight?: number;
  private text = "";
  constructor(readonly tagName: string) { super(); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get childElementCount(): number { return this.children.length; }
  get scrollHeight(): number { return this.measuredScrollHeight ?? measuredHeight; }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
  append(...nodes: ElementStub[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: ElementStub[]): void { this.children = nodes; this.text = ""; }
  attachShadow(): ElementStub { return this.shadowRoot = new ElementStub("shadow-root"); }
  remove(): void {}
  querySelector(tag: string): ElementStub | null { return descendants(this).find((node) => node.tagName === tag) ?? null; }
}
function descendants(element: ElementStub): ElementStub[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}
function setup(onRetry?: () => void): { view: SearchCardView; article: ElementStub; onOpen: ReturnType<typeof vi.fn> } {
  measuredHeight = 200;
  observers = [];
  vi.stubGlobal("document", { createElement: (tag: string) => new ElementStub(tag) });
  vi.stubGlobal("window", { innerHeight: 800 });
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    constructor(readonly callback: () => void) { observers.push(this); }
    observe() {}
  });
  const onOpen = vi.fn();
  const view = new SearchCardView(onOpen, onRetry);
  const article = (view.host as unknown as ElementStub).shadowRoot!.querySelector("article")!;
  return { view, article, onOpen };
}
beforeEach(() => vi.stubGlobal("navigator", { language: "ja" }));
afterEach(() => vi.unstubAllGlobals());

describe("minimal Gemini answer card", () => {
  it("localizes controls and statuses without translating answer text or changing preview rules", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const { view, article } = setup(vi.fn());
    expect(article.lang).toBe("en");
    expect(article.textContent).toBe("Open Gemini window");
    measuredHeight = 900;
    const state = { jobId: "english", pipReady: true, status: "Geminiに送信しています…", progressText: "日本語の回答本文", conversationUrl: "https://gemini.google.com/app/en123" };
    view.render(state);
    const toggle = descendants(article).find((node) => node.className === "expand")!;
    const cta = descendants(article).find((node) => node.className === "conversation")!;
    expect(article.textContent).toContain("Sending to Gemini…");
    expect(article.textContent).toContain("日本語の回答本文");
    expect(toggle.textContent).toBe("Show more");
    expect(cta.hidden).toBe(true);
    expect(article.children[1]!.textContent).toBe("Open Gemini window");
    toggle.dispatchEvent(new Event("click"));
    expect(toggle.textContent).toBe("Show less");
    expect(cta.textContent).toBe("Continue this conversation in Gemini");
    expect(cta.hidden).toBe(false);
    vi.stubGlobal("navigator", { language: "ja" });
    view.render(state);
    expect(article.lang).toBe("ja");
    expect(descendants(article).find((node) => node.className === "expand")!.textContent).toBe("折りたたむ");
    expect(descendants(article).find((node) => node.className === "conversation")!.hidden).toBe(false);
  });
  it("shows the retry action only when requested and invokes its separate callback", () => {
    const onRetry = vi.fn();
    const { view, article, onOpen } = setup(onRetry);
    expect(descendants(article).filter((node) => node.tagName === "button")).toHaveLength(1);
    view.render({ detail: "入力欄を確認してください。", canRetry: true });
    const buttons = descendants(article).filter((node) => node.tagName === "button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Geminiウィンドウを開く", "この検索を再送信"]);
    expect(buttons[1]!.type).toBe("button");
    buttons[1]!.dispatchEvent(new Event("click"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    view.render({ canRetry: false });
    expect(descendants(article).filter((node) => node.tagName === "button")).toHaveLength(1);
    expect(article.children[1]!.hidden).toBe(true);
  });

  it("does not show a retry action without a retry callback", () => {
    const { view, article } = setup();
    view.render({ canRetry: true });
    expect(descendants(article).filter((node) => node.tagName === "button")).toHaveLength(1);
    expect(article.children[1]!.hidden).toBe(true);
  });

  it("initially displays only the owner-opening button, and keeps it usable during generation", () => {
    const { view, article, onOpen } = setup();
    expect(article.textContent).toBe("Geminiウィンドウを開く");
    expect(descendants(article).map((node) => node.tagName)).toEqual(["button", "div"]);
    expect(article.children[1]!.hidden).toBe(true);
    view.render({ status: "生成中", busy: true, progressText: "<img src=x onerror=alert(1)>" });
    const button = descendants(article).find((node) => node.className === "owner compact")!;
    button.dispatchEvent(new Event("click"));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(button.attributes.get("aria-busy")).toBe("true");
    expect(article.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(descendants(article).some((node) => node.tagName === "img")).toBe(false);
    view.render();
    expect(article.textContent).toBe("Geminiウィンドウを開く");
    expect(article.children[1]!.hidden).toBe(true);
  });

  it("renders bounded structured text and safe sources; only a real conversation gets the action link", () => {
    const { view, article } = setup();
    const answer: StructuredAnswer = {
      jobId: "job", sourceTabId: 1, completedAt: 1, plainText: "Literal answer",
      blocks: [
        { type: "heading", level: 1, text: "見出し" },
        { type: "paragraph", text: "<script>literal</script>" },
        { type: "list", ordered: true, items: ["one", "two"] },
        { type: "code", code: "<b>literal</b>" },
        { type: "quote", text: "quote" },
      ],
      links: [{ label: "Source", url: "https://example.com/" }, { label: "Unsafe", url: "javascript:alert(1)" }],
    };
    view.render({ answer, conversationUrl: "https://gemini.google.com/app" });
    let links = descendants(article).filter((node) => node.tagName === "a");
    expect(links.map((link) => link.href)).toEqual(["https://example.com/"]);
    expect(descendants(article).map((node) => node.tagName)).toEqual(expect.arrayContaining(["h3", "p", "ol", "code", "blockquote"]));
    expect(descendants(article).some((node) => node.tagName === "script" || node.tagName === "b")).toBe(false);
    view.render({ answer, conversationUrl: "https://gemini.google.com/u/1/app/abc_123" });
    links = descendants(article).filter((node) => node.tagName === "a");
    expect(links[1]!.textContent).toBe("Geminiを開いて会話を続ける");
    expect(links[1]!.href).toBe("https://gemini.google.com/u/1/app/abc_123");
    expect(links.every((link) => link.target === "_blank" && link.rel === "noopener noreferrer")).toBe(true);
  });

  it("retains HTTP URL validation for sources", () => {
    expect(sanitizeCardLink("https://example.com")).toBe("https://example.com/");
    expect(sanitizeCardLink("javascript:alert(1)")).toBeNull();
  });
  it("uses the organic results column rather than a wider surrounding region", () => {
    const { view } = setup();
    const prepend = vi.fn();
    Object.assign(document, { querySelector: (selector: string) => selector === "#rso" ? { prepend } : null });
    view.mount();
    expect(prepend).toHaveBeenCalledWith(view.host);
    expect(view.host.dataset.floating).toBe("false");
  });

  it("keeps completed-answer nodes and expanded preview state on identical renders", () => {
    const { view, article } = setup();
    const answer: StructuredAnswer = {
      jobId: "completed-job", sourceTabId: 1, completedAt: 1, plainText: "Completed answer",
      blocks: [{ type: "paragraph", text: "Completed answer" }],
      links: [{ label: "Source", url: "https://example.com/" }],
    };
    const state = { status: "回答が完了しました", answer, conversationUrl: "https://gemini.google.com/app/abc123", busy: false };
    measuredHeight = 900;
    view.render(state);
    const output = article.children.find((node) => node.className === "output")!;
    const preview = descendants(output).find((node) => node.className === "preview")!;
    const toggle = descendants(output).find((node) => node.className === "expand")!;
    const answerNode = preview.children[0]!.children[0]!;
    const links = descendants(output).filter((node) => node.tagName === "a");
    toggle.dispatchEvent(new Event("click"));
    const replaceChildren = vi.spyOn(output, "replaceChildren");

    view.render(state);
    view.render(structuredClone(state));

    expect(replaceChildren).not.toHaveBeenCalled();
    expect(descendants(output).find((node) => node.className === "preview")).toBe(preview);
    expect(preview.children[0]!.children[0]).toBe(answerNode);
    expect(preview.dataset.expanded).toBe("true");
    expect(toggle.textContent).toBe("折りたたむ");
    const currentLinks = descendants(output).filter((node) => node.tagName === "a");
    expect(currentLinks).toHaveLength(2);
    expect(currentLinks[0]).toBe(links[0]);
    expect(currentLinks[1]).toBe(links[1]);
  });

  it("shows a measured long-answer preview, exposes sources on expansion and folds it again", () => {
    const { view, article } = setup();
    measuredHeight = 900;
    view.render({ answer: {
      jobId: "long", sourceTabId: 1, completedAt: 1, plainText: "Long answer",
      blocks: [{ type: "paragraph", text: "Long answer" }],
      links: [{ label: "Safe", url: "https://example.com/" }, { label: "Unsafe", url: "javascript:alert(1)" }],
    }, conversationUrl: "https://gemini.google.com/app/abc123" });
    const preview = descendants(article).find((node) => node.className === "preview")!;
    const toggle = descendants(article).find((node) => node.className === "expand")!;
    const sources = descendants(article).find((node) => node.className === "sources")!;
    const conversation = descendants(article).find((node) => node.className === "conversation")!;
    expect(conversation.hidden).toBe(true);
    expect(preview.dataset.clipped).toBe("true");
    expect(toggle.hidden).toBe(false);
    expect(toggle.attributes.get("aria-expanded")).toBe("false");
    expect(toggle.attributes.get("aria-controls")).toBe(preview.id);
    expect(sources.inert).toBe(true);
    expect(descendants(article).filter((node) => node.tagName === "a").map((node) => node.href))
      .toEqual(["https://example.com/", "https://gemini.google.com/app/abc123"]);
    toggle.dispatchEvent(new Event("click"));
    expect(toggle.textContent).toBe("折りたたむ");
    expect(toggle.attributes.get("aria-expanded")).toBe("true");
    expect(preview.dataset.clipped).toBe("false");
    expect(sources.inert).toBe(false);
    expect(conversation.hidden).toBe(false);
    toggle.dispatchEvent(new Event("click"));
    expect(toggle.textContent).toBe("もっと見る");
    expect(preview.dataset.clipped).toBe("true");
    expect(conversation.hidden).toBe(true);
    const css = (view.host as unknown as ElementStub).shadowRoot!.querySelector("style")!.textContent;
    expect(css).toContain("max-height:min(210px,27.5vh); overflow:hidden");
    expect(css).toContain('.preview[data-expanded="true"] { max-height:none; overflow:visible; }');
  });

  it("caps streaming too, retains expansion through completion and resets it for a new job", () => {
    const { view, article } = setup();
    measuredHeight = 900;
    const toggle = () => descendants(article).find((node) => node.className === "expand")!;
    view.render({ jobId: "same", progressText: "partial" });
    expect(toggle().hidden).toBe(false);
    toggle().dispatchEvent(new Event("click"));
    view.render({ jobId: "same", progressText: "partial growing", status: "生成中" });
    expect(toggle().attributes.get("aria-expanded")).toBe("true");
    view.render({ jobId: "same", answer: {
      jobId: "same", sourceTabId: 1, completedAt: 1, plainText: "complete",
      blocks: [{ type: "paragraph", text: "complete" }], links: [],
    } });
    expect(toggle().attributes.get("aria-expanded")).toBe("true");
    view.render({ jobId: "next", progressText: "next partial" });
    expect(toggle().attributes.get("aria-expanded")).toBe("false");
    toggle().dispatchEvent(new Event("click"));
    view.render();
    view.render({ jobId: "next", progressText: "next partial" });
    expect(toggle().attributes.get("aria-expanded")).toBe("false");
  });

  it("has no redundant expander for short or empty output, and remeasures on resize", () => {
    const { view, article } = setup();
    view.render({ progressText: "short" });
    const toggle = descendants(article).find((node) => node.className === "expand")!;
    expect(toggle.hidden).toBe(true);
    Object.assign(window, { innerHeight: 300 });
    observers[0]!.callback();
    expect(toggle.hidden).toBe(false);
    measuredHeight = 10;
    observers[0]!.callback();
    expect(toggle.hidden).toBe(true);
    view.render();
    expect(descendants(article).some((node) => node.className === "expand")).toBe(false);
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
    view.render({ progressText: "short" });
    view.remove();
    expect(observers[1]!.disconnect).toHaveBeenCalledOnce();
  });

  it("includes the leading answer margin when detecting clipping near the height cap", () => {
    const { view, article } = setup();
    Object.assign(window, { innerHeight: 1000 });
    measuredHeight = 204;
    view.render({ jobId: "margin", progressText: "answer near the cap" });
    const preview = descendants(article).find((node) => node.className === "preview")!;
    const toggle = descendants(article).find((node) => node.className === "expand")!;
    preview.children[0]!.measuredScrollHeight = 204;
    preview.measuredScrollHeight = 218; // 204px body plus its 14px leading answer margin.
    observers[0]!.callback();
    expect(toggle.hidden).toBe(false);
    expect(preview.dataset.clipped).toBe("true");
    toggle.dispatchEvent(new Event("click"));
    expect(preview.dataset.expanded).toBe("true");
    expect(toggle.textContent).toBe("折りたたむ");
  });

  it("puts the full-width conversation action after a short answer and the small owner last", () => {
    const { view, article, onOpen } = setup();
    const owner = article.children[0]!;
    measuredHeight = 100;
    view.render({ answer: {
      jobId: "short", sourceTabId: 1, completedAt: 1, plainText: "Short answer",
      blocks: [{ type: "paragraph", text: "Short answer" }], links: [],
    }, conversationUrl: "https://gemini.google.com/app/short123" });
    const output = article.children[0]!;
    expect(article.children).toEqual([output, owner]);
    expect(owner.className).toBe("owner compact");
    expect(output.children.map((node) => node.className)).toEqual(["preview", "conversation", "expand"]);
    const cta = output.children[1]!;
    expect(cta.tagName).toBe("a");
    expect(cta.textContent).toBe("Geminiを開いて会話を続ける");
    expect(cta.href).toBe("https://gemini.google.com/app/short123");
    expect(cta.target).toBe("_blank");
    expect(cta.rel).toBe("noopener noreferrer");
    expect(cta.hidden).toBe(false);
    expect(output.children[2]!.hidden).toBe(true);
    expect(descendants(article).filter((node) => node.className.startsWith("owner"))).toHaveLength(1);
    owner.dispatchEvent(new Event("click"));
    expect(onOpen).toHaveBeenCalledOnce();
    const css = (view.host as unknown as ElementStub).shadowRoot!.querySelector("style")!.textContent;
    expect(css).toContain(".conversation { display:flex;");
    expect(css).toContain("justify-content:center; width:100%; min-height:44px;");
    expect(css).toContain("margin:12px 0 0 auto;");
  });

  it("keeps the CTA before the fold control for expanded long answers", () => {
    const { view, article } = setup();
    measuredHeight = 900;
    view.render({ jobId: "long-footer", progressText: "Long answer", conversationUrl: "https://gemini.google.com/app/long123" });
    const output = article.children[0]!;
    expect(output.children.map((node) => node.className)).toEqual(["preview", "conversation", "expand"]);
    const toggle = output.children[2]!;
    expect(toggle.textContent).toBe("もっと見る");
    expect(output.children[1]!.hidden).toBe(true);
    toggle.dispatchEvent(new Event("click"));
    expect(output.children[1]!.hidden).toBe(false);
    expect(output.children[1]!.textContent).toBe("Geminiを開いて会話を続ける");
    expect(output.children[2]!.textContent).toBe("折りたたむ");
    expect(output.children[0]!.dataset.expanded).toBe("true");
  });

  it("keeps a ready PiP owner's button small at the bottom before any answer arrives", () => {
    const { view, article, onOpen } = setup();
    const owner = article.children[0]!;
    for (const status of [undefined, "Geminiに送信しています…", "生成中…"]) {
      view.render({ pipReady: true, ...(status ? { status } : {}) });
      expect(article.children[1]).toBe(owner);
      expect(owner.className).toBe("owner compact");
      expect(article.dataset.compact).toBe("true");
      expect(descendants(article).filter((node) => node.className.startsWith("owner"))).toHaveLength(1);
    }
    view.render({ pipReady: true, detail: "前の結果を復元できません", canRetry: true });
    expect(article.children[1]).toBe(owner);
    expect(owner.className).toBe("owner compact");
    owner.dispatchEvent(new Event("click"));
    expect(onOpen).toHaveBeenCalledOnce();
    view.render({ pipReady: false, status: "PiP小窓を開いてください" });
    expect(article.children[0]).toBe(owner);
    expect(owner.className).toBe("owner");
  });

  it("updates conversation visibility when a short reply grows beyond the cap or shrinks", () => {
    const { view, article } = setup();
    measuredHeight = 100;
    view.render({ jobId: "growing", progressText: "partial", conversationUrl: "https://gemini.google.com/app/grow123" });
    const cta = descendants(article).find((node) => node.className === "conversation")!;
    const toggle = descendants(article).find((node) => node.className === "expand")!;
    expect(cta.hidden).toBe(false);
    measuredHeight = 900; observers[0]!.callback();
    expect(cta.hidden).toBe(true);
    expect(toggle.hidden).toBe(false);
    toggle.dispatchEvent(new Event("click"));
    expect(cta.hidden).toBe(false);
    toggle.dispatchEvent(new Event("click"));
    expect(cta.hidden).toBe(true);
    measuredHeight = 100; observers[0]!.callback();
    expect(cta.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);
  });

  it("restores the prominent owner placement for initial and attention states", () => {
    const { view, article } = setup();
    const owner = article.children[0]!;
    view.render({ progressText: "partial" });
    expect(article.children[1]).toBe(owner);
    expect(owner.className).toBe("owner compact");
    view.render({ progressText: "partial", detail: "確認してください", canRetry: true });
    expect(article.children[0]).toBe(owner);
    expect(owner.className).toBe("owner");
    expect(article.dataset.compact).toBe("false");
    view.render({ progressText: "partial" });
    expect(owner.className).toBe("owner compact");
    view.render();
    expect(article.children[0]).toBe(owner);
    expect(owner.className).toBe("owner");
    expect(article.children[1]!.hidden).toBe(true);
  });
});
