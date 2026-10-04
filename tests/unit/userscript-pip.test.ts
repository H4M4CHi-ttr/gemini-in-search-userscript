import { describe, expect, it, vi } from "vitest";
import { MAX_ANSWER_TEXT_LENGTH } from "../../src/shared/answer-models";
import { PipCompanion } from "../../src/userscript/pip";

class FakeElement extends EventTarget {
  textContent = "";
  type = "";
  children: FakeElement[] = [];
  attributes = new Map<string, string>();

  constructor(readonly tagName: string) { super(); }
  set innerHTML(_value: string) { throw new Error("HTML parsing is forbidden in the companion"); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...elements: FakeElement[]): void { this.children.push(...elements); }
  replaceChildren(...elements: FakeElement[]): void { this.children = elements; }
}

class FakeDocument extends EventTarget {
  title = "";
  visibilityState = "visible";
  head = new FakeElement("head");
  body = new FakeElement("body");
  createElement = vi.fn((name: string) => new FakeElement(name));
}

class FakeWindow extends EventTarget {
  closed = false;
  document = new FakeDocument();
  focus = vi.fn();
  close = vi.fn(() => {
    this.closed = true;
    this.dispatchEvent(new Event("pagehide"));
  });
}

function fixture() {
  const owner = new FakeWindow();
  const pip = new FakeWindow();
  const api = {
    window: null as FakeWindow | null,
    requestWindow: vi.fn(() => { api.window = pip; return Promise.resolve(pip as unknown as Window); }),
  };
  Object.assign(owner, { documentPictureInPicture: api });
  const changed = vi.fn();
  const companion = new PipCompanion(owner as unknown as Window, changed);
  return { owner, pip, api, changed, companion };
}

function element(pip: FakeWindow, tagName: string): FakeElement {
  const found = pip.document.body.children.find((child) => child.tagName === tagName);
  if (!found) throw new Error(`Missing ${tagName}`);
  return found;
}

describe("userscript Document Picture-in-Picture companion", () => {
  it("does not open automatically and reports unsupported native API without changing Gemini", async () => {
    const owner = new FakeWindow();
    const changed = vi.fn();
    const companion = new PipCompanion(owner as unknown as Window, changed);
    companion.update("Generating", "Cached answer");
    expect(companion.available).toBe(false);
    expect(companion.visible()).toBe(false);
    await expect(companion.open()).rejects.toThrow("not available");
    expect(owner.document.createElement).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();

    const supported = fixture();
    supported.companion.update("Ready", "Previous answer");
    expect(supported.companion.available).toBe(true);
    expect(supported.api.requestWindow).not.toHaveBeenCalled();
  });

  it("requests the native window synchronously and cancels an in-flight open when closed", async () => {
    const { companion, api, pip, changed } = fixture();
    let resolve!: (value: Window) => void;
    api.requestWindow.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const opening = companion.open();
    expect(api.requestWindow).toHaveBeenCalledWith({ width: 360, height: 260 });
    await expect(companion.open()).rejects.toThrow("already opening");
    companion.close();
    resolve(pip as unknown as Window);
    await opening;
    expect(pip.close).toHaveBeenCalledOnce();
    expect(pip.document.createElement).not.toHaveBeenCalled();
    expect(companion.visible()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(api.requestWindow).toHaveBeenCalledOnce();
  });

  it("renders cached status and bounded literal text in its own blank document", async () => {
    const { companion, owner, pip } = fixture();
    const geminiNode = new FakeElement("main");
    owner.document.body.append(geminiNode);
    const markup = '<script>alert("no")</script><a href="https://example.com">answer</a>\n';
    companion.update("<b>Generating</b>", markup + "x".repeat(MAX_ANSWER_TEXT_LENGTH));
    await companion.open();
    expect(pip.document.title).toBe("Gemini Search Bridge");
    expect(element(pip, "h1").textContent).toBe("Gemini Search Bridge");
    expect(element(pip, "p").textContent).toBe("<b>Generating</b>");
    expect(element(pip, "pre").textContent).toBe((markup + "x".repeat(MAX_ANSWER_TEXT_LENGTH)).slice(0, MAX_ANSWER_TEXT_LENGTH));
    expect(element(pip, "pre").attributes.get("aria-live")).toBe("off");
    expect(pip.document.createElement.mock.calls.map(([tag]) => tag)).not.toContain("script");
    expect(pip.document.head.children[0]?.textContent).toContain("white-space:pre-wrap");
    expect(owner.document.body.children).toEqual([geminiNode]);
    expect(owner.document.createElement).not.toHaveBeenCalled();
    companion.update("Completed", "Final answer");
    expect(element(pip, "pre").textContent).toBe("Final answer");
    element(pip, "button").dispatchEvent(new Event("click"));
    expect(owner.focus).toHaveBeenCalledOnce();
  });

  it("reuses its own window and reports actual visibility changes", async () => {
    const { companion, api, pip, changed } = fixture();
    await companion.open();
    expect(companion.visible()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    await companion.open();
    expect(pip.focus).toHaveBeenCalledOnce();
    expect(api.requestWindow).toHaveBeenCalledOnce();
    pip.document.visibilityState = "hidden";
    pip.document.dispatchEvent(new Event("visibilitychange"));
    expect(companion.visible()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    pip.document.visibilityState = "visible";
    pip.document.dispatchEvent(new Event("visibilitychange"));
    expect(companion.visible()).toBe(true);
    pip.closed = true;
    expect(companion.visible()).toBe(false);
  });

  it("releases before notifying on explicit close and never reopens on cached updates", async () => {
    const { companion, api, pip, changed } = fixture();
    await companion.open();
    changed.mockImplementation(() => expect(companion.visible()).toBe(false));
    companion.close();
    expect(pip.close).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(2);
    companion.close();
    companion.update("Closed", "Kept for the next explicit open");
    expect(api.requestWindow).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("handles native pagehide and ignores stale events after a new explicit open", async () => {
    const { companion, api, pip, changed } = fixture();
    await companion.open();
    pip.close();
    expect(companion.visible()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    companion.update("Ready", "New answer");
    const next = new FakeWindow();
    api.requestWindow.mockImplementation(() => { api.window = next; return Promise.resolve(next as unknown as Window); });
    await companion.open();
    expect(companion.visible()).toBe(true);
    expect(element(next, "pre").textContent).toBe("New answer");
    pip.dispatchEvent(new Event("pagehide"));
    pip.document.dispatchEvent(new Event("visibilitychange"));
    expect(companion.visible()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("does not replace a PiP window owned by another feature of the same opener", async () => {
    const { companion, api, changed } = fixture();
    const foreign = new FakeWindow();
    foreign.document.body.append(new FakeElement("video"));
    api.window = foreign;
    await expect(companion.open()).rejects.toThrow("Another Picture-in-Picture window");
    expect(api.requestWindow).not.toHaveBeenCalled();
    expect(foreign.close).not.toHaveBeenCalled();
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(foreign.document.body.children[0]?.tagName).toBe("video");
    expect(changed).not.toHaveBeenCalled();
  });

  it("propagates native permission failures and allows a later explicit retry", async () => {
    const { companion, api } = fixture();
    api.requestWindow.mockRejectedValueOnce(new Error("A user gesture is required"));
    await expect(companion.open()).rejects.toThrow("Could not open the Gemini companion: A user gesture is required");
    expect(companion.visible()).toBe(false);
    expect(api.requestWindow).toHaveBeenCalledOnce();
    await companion.open();
    expect(companion.visible()).toBe(true);
    expect(api.requestWindow).toHaveBeenCalledTimes(2);
  });
});
