import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerView } from "../../src/userscript/worker-view";

class FakeElement extends EventTarget {
  id = "";
  className = "";
  textContent = "";
  type = "";
  hidden = false;
  disabled = false;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  shadowRoot: FakeElement | null = null;
  focus = vi.fn();
  constructor(readonly tagName: string) { super(); }
  set innerHTML(_value: string) { throw new Error("HTML parsing is forbidden"); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...elements: FakeElement[]): void { this.children.push(...elements); }
  attachShadow(): FakeElement { return this.shadowRoot = new FakeElement("shadow-root"); }
}

function find(root: FakeElement, className: string): FakeElement {
  if (root.className.split(" ").includes(className)) return root;
  for (const child of root.children) {
    try { return find(child, className); } catch { /* Search the next sibling. */ }
  }
  throw new Error(`Missing ${className}`);
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini PiP onboarding", () => {
  it("keeps Gemini intact, starts only in the click stack, and supports reveal/reopen and stopped states", () => {
    const body = new FakeElement("body");
    const gemini = new FakeElement("main");
    body.append(gemini);
    vi.stubGlobal("document", { body, createElement: (name: string) => new FakeElement(name) });
    const open = vi.fn();
    const close = vi.fn();
    const view = new WorkerView({ onOpenPip: open, onClosePip: close });
    expect(body.children[0]).toBe(gemini);
    expect(body.children).toHaveLength(2);
    const root = body.children[1]!.shadowRoot!;
    const screen = find(root, "screen");
    const primary = find(root, "primary");
    const ready = find(root, "ready");
    const paused = find(root, "paused");
    const pill = find(root, "pill");
    expect(screen.attributes.get("role")).toBe("region");
    expect(screen.attributes.has("aria-modal")).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(primary.disabled).toBe(true);
    expect(ready.hidden).toBe(true);

    view.update({ pipReady: false, supported: true });
    expect(primary.disabled).toBe(false);
    let insideClick = false;
    open.mockImplementation(() => expect(insideClick).toBe(true));
    insideClick = true;
    primary.dispatchEvent(new Event("click"));
    insideClick = false;
    expect(open).toHaveBeenCalledOnce();

    view.update({ pipReady: true, supported: true });
    expect(ready.hidden).toBe(false);
    expect(paused.hidden).toBe(true);
    expect(primary.disabled).toBe(true);
    expect(find(root, "close").hidden).toBe(false);
    find(root, "close").dispatchEvent(new Event("click"));
    expect(close).toHaveBeenCalledOnce();

    view.revealGemini();
    expect(screen.hidden).toBe(true);
    expect(pill.hidden).toBe(false);
    expect(pill.focus).toHaveBeenCalledOnce();
    pill.dispatchEvent(new Event("click"));
    expect(screen.hidden).toBe(false);
    expect(pill.hidden).toBe(true);
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    screen.dispatchEvent(escape);
    expect(screen.hidden).toBe(true);
    expect(escape.defaultPrevented).toBe(true);

    view.update({ pipReady: false, supported: true, status: "<b>PiPを開けませんでした</b>" });
    expect(find(root, "status").textContent).toBe("<b>PiPを開けませんでした</b>");
    expect(ready.hidden).toBe(true);
    expect(paused.hidden).toBe(false);
    view.update({ pipReady: false, supported: false });
    expect(primary.disabled).toBe(true);
    expect(paused.textContent).toContain("自動送信は停止しています");
    expect(open).toHaveBeenCalledOnce();
    expect(body.children[0]).toBe(gemini);
    expect(gemini.hidden).toBe(false);
    expect(gemini.attributes.size).toBe(0);
  });
});
