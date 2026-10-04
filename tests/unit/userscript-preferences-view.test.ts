import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPreferences } from "../../src/userscript/preferences-view";
import { DEFAULT_TEMPLATES, PREFERENCES_KEY } from "../../src/userscript/preferences";

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  shadowRoot: ElementStub | null = null;
  activeElement: ElementStub | null = null;
  parent: ElementStub | null = null;
  className = ""; id = ""; lang = ""; value = ""; type = "";
  hidden = false; disabled = false; checked = false; isConnected = false;
  focus = vi.fn();
  private text = "";
  constructor(readonly tagName: string) { super(); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  set innerHTML(_value: string) { throw new Error("HTML parsing is forbidden"); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...nodes: ElementStub[]): void { for (const node of nodes) { node.parent = this; node.isConnected = true; this.children.push(node); } }
  attachShadow(): ElementStub { return this.shadowRoot = new ElementStub("shadow-root"); }
  remove(): void { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}
const descendants = (node: ElementStub): ElementStub[] => [node, ...node.children.flatMap(descendants)];
let body: ElementStub;
let values: Map<string, unknown>;
let save: ReturnType<typeof vi.fn>;
let settingsWindow: EventTarget;
const view = (): ElementStub => body.children[0]!.shadowRoot!.children[1]!;
const field = (id: string): ElementStub => descendants(view()).find((node) => node.id === id)!;
const tag = (name: string): ElementStub => descendants(view()).find((node) => node.tagName === name)!;
const button = (label: string): ElementStub => descendants(view()).find((node) => node.tagName === "button" && node.textContent === label)!;

beforeEach(() => {
  body = new ElementStub("body"); values = new Map(); settingsWindow = new EventTarget();
  vi.stubGlobal("document", { body, activeElement: null, createElement: (name: string) => new ElementStub(name) });
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("navigator", { language: "en-US" }); vi.stubGlobal("window", settingsWindow);
  vi.stubGlobal("GM_getValue", (key: string, fallback: unknown) => values.get(key) ?? fallback);
  save = vi.fn((key: string, value: unknown) => values.set(key, value)); vi.stubGlobal("GM_setValue", save);
});
afterEach(() => {
  if (body.children.length) descendants(view()).find((node) => node.tagName === "button")!.dispatchEvent(new Event("click"));
  vi.unstubAllGlobals();
});

describe("language and prompt template settings", () => {
  it("copies the currently localized default on first custom selection and preserves deliberate empty drafts", () => {
    openPreferences();
    const language = field("gsb-language"); const textarea = field("gsb-template"); const checkbox = tag("input");
    expect(textarea.value).toBe(DEFAULT_TEMPLATES.en);
    language.value = "ja"; language.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe(DEFAULT_TEMPLATES.ja);
    checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe(DEFAULT_TEMPLATES.ja);
    textarea.value = ""; textarea.dispatchEvent(new Event("input"));
    checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe(DEFAULT_TEMPLATES.ja);
    checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe("");
    tag("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(save).not.toHaveBeenCalled();
    expect(textarea.attributes.get("aria-invalid")).toBe("true");
  });

  it.each(["Close", "Escape"])("returns focus to the actual opener in nested shadow roots after %s", (method) => {
    const outerHost = new ElementStub("div");
    const innerHost = new ElementStub("div");
    const opener = new ElementStub("button"); opener.isConnected = true;
    outerHost.attachShadow().activeElement = innerHost;
    innerHost.attachShadow().activeElement = opener;
    Object.assign(document, { activeElement: outerHost });
    openPreferences();
    if (method === "Close") button("Close").dispatchEvent(new Event("click"));
    else {
      const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
      view().dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
    }
    expect(body.children).toHaveLength(0);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(outerHost.focus).not.toHaveBeenCalled();
    expect(innerHost.focus).not.toHaveBeenCalled();
  });

  it("opens only one nonmodal region, starts with localized defaults, and writes nothing until save", () => {
    openPreferences(); openPreferences();
    expect(body.children).toHaveLength(1);
    expect(view().attributes.get("role")).toBe("region");
    expect(view().attributes.has("aria-modal")).toBe(false);
    expect(view().lang).toBe("en");
    expect(field("gsb-language").value).toBe("auto");
    expect(tag("input").checked).toBe(true);
    expect(field("gsb-template").disabled).toBe(true);
    expect(field("gsb-template").value).toBe(DEFAULT_TEMPLATES.en);
    expect(save).not.toHaveBeenCalled();
    expect(view().textContent).toContain("This does not resend your current search");
    tag("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(values.get(PREFERENCES_KEY)).toEqual({ version: 1, language: "auto", promptTemplate: null });
  });

  it("uses literal custom input, validates the placeholder accessibly, and emits a refresh event on save", () => {
    openPreferences();
    const checkbox = tag("input"); const textarea = field("gsb-template");
    checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
    textarea.value = "missing placeholder"; textarea.dispatchEvent(new Event("input"));
    tag("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(save).not.toHaveBeenCalled();
    expect(field("gsb-settings-message").textContent).toBe("Include %%prompt%% in the template.");
    expect(textarea.attributes.get("aria-invalid")).toBe("true");
    textarea.value = '<img onerror="boom"> %%prompt%% $&'; textarea.dispatchEvent(new Event("input"));
    const changed = vi.fn(); settingsWindow.addEventListener("gsb-preferences-changed", changed);
    tag("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(changed).toHaveBeenCalledOnce();
    expect(values.get(PREFERENCES_KEY)).toEqual({ version: 1, language: "auto", promptTemplate: textarea.value });
    expect(textarea.attributes.get("aria-invalid")).toBe("false");
    expect(descendants(view()).some((node) => node.tagName === "img")).toBe(false);
    expect(field("gsb-settings-message").textContent).toContain("Saved");
  });

  it("preserves the custom draft through language refresh and default toggling; reset requires save", () => {
    openPreferences(); const textarea = field("gsb-template"); const checkbox = tag("input");
    checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
    textarea.value = "Custom %%prompt%%"; textarea.dispatchEvent(new Event("input"));
    values.set(PREFERENCES_KEY, { version: 1, language: "ja", promptTemplate: null });
    settingsWindow.dispatchEvent(new Event("gsb-preferences-changed"));
    expect(field("gsb-template")).toBe(textarea); expect(textarea.value).toBe("Custom %%prompt%%");
    expect(view().lang).toBe("ja"); expect(view().textContent).toContain("ユーザースクリプト設定");
    checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
    expect(textarea.disabled).toBe(true);
    checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe("Custom %%prompt%%");
    button("既定に戻す").dispatchEvent(new Event("click"));
    expect(checkbox.checked).toBe(true); expect(field("gsb-language").value).toBe("auto");
    expect(save).not.toHaveBeenCalled();
    tag("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(values.get(PREFERENCES_KEY)).toEqual({ version: 1, language: "auto", promptTemplate: null });
  });
});
