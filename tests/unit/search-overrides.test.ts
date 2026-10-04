import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GEMINI_ICON } from "../../src/shared/gemini-icon";
import { isAiModeLink, SearchOverrides } from "../../src/content/google/search-overrides";

// Small DOM model for native tag/class/attribute selection and mutation counts.
class NodeStub {
  readonly attributes = new Map<string, string>();
  readonly tagName: string;
  children: NodeStub[] = [];
  parent: NodeStub | null = null;
  connected = false;
  writes = 0;
  private text = "";
  private url = "";
  title = "";
  target = "";
  rel = "";
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get parentElement(): NodeStub | null { return this.parent; }
  get isConnected(): boolean { return this.parent?.isConnected ?? this.connected; }
  get id(): string { return this.getAttribute("id") ?? ""; }
  get className(): string { return this.getAttribute("class") ?? ""; }
  set className(value: string) { this.setAttribute("class", value); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) {
    this.writes++;
    for (const child of this.children) child.parent = null;
    this.children = []; this.text = value;
  }
  get href(): string { return this.url; }
  set href(value: string) { this.url = value; this.setAttribute("href", value); }
  setAttribute(key: string, value: string): void { this.writes++; this.attributes.set(key, value); }
  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string): boolean { return this.attributes.has(key); }
  removeAttribute(key: string): void { this.writes++; this.attributes.delete(key); }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const target = part.trim();
      const tag = target.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = target.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      const classes = [...target.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
      if (classes.some((name) => !this.className.split(/\s+/).includes(name))) return false;
      return [...target.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every((match) =>
        match[2] === undefined ? this.hasAttribute(match[1]!) : this.getAttribute(match[1]!) === match[2]);
    });
  }
  querySelectorAll(selector: string): NodeStub[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): NodeStub | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): NodeStub | null { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  contains(node: NodeStub): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  append(node: NodeStub): void { this.writes++; node.parent = this; this.children.push(node); }
  replaceChildren(...nodes: NodeStub[]): void {
    this.writes++;
    for (const child of this.children) child.parent = null;
    this.text = ""; this.children = nodes;
    for (const node of nodes) node.parent = this;
  }
  after(node: NodeStub): void {
    this.parent!.writes++; node.parent = this.parent;
    this.parent!.children.splice(this.parent!.children.indexOf(this) + 1, 0, node);
  }
  remove(): void {
    this.writes++;
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.connected = false;
  }
}
function node(tag: string, attributes: Record<string, string> = {}, text = ""): NodeStub {
  const result = new NodeStub(tag);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  if (text) result.textContent = text;
  return result;
}
function setup() {
  const root = node("html"); root.connected = true;
  const head = node("head"); root.append(head);
  const nav = node("nav"); root.append(nav);
  let callback: () => void = () => {};
  const disconnected = vi.fn(); const observe = vi.fn();
  vi.stubGlobal("MutationObserver", class {
    constructor(fn: () => void) { callback = fn; }
    observe = observe;
    disconnect = disconnected;
  });
  const doc = {
    head, documentElement: root, baseURI: "https://www.google.com/search?q=test",
    createElement: (tag: string) => node(tag),
    querySelectorAll: vi.fn((selector: string) => selector.startsWith("#hdtb")
      ? root.querySelectorAll("a[href]").filter((anchor) => anchor.parent?.closest('#hdtb, nav, [role="navigation"]'))
      : root.querySelectorAll(selector)),
  } as unknown as Document;
  return { doc, root, head, nav, notify: () => callback(), disconnected, observe };
}
function aiLink(nav: NodeStub, label = "AI モード", href = "https://www.google.com/search?q=test&udm=50"): NodeStub {
  const anchor = node("a", {}, label); anchor.href = href; nav.append(anchor); return anchor;
}
function knownShell(root: NodeStub, moreLabel = "その他の AI による概要を表示") {
  const owner = node("div", { class: "MjjYud" }); root.append(owner);
  const shell = node("div", { id: "eKIzJc", class: "SePcAf", "data-lhcontainer": "1", "data-tma": "80" }); owner.append(shell);
  shell.append(node("style"));
  const seed = node("div", { id: "m-x-content", class: "D5ad8b" });
  let container = node("div", { class: "YzCcne" }); shell.append(container);
  for (let i = 0; i < 6; i++) { const wrapper = node("div"); container.append(wrapper); container = wrapper; }
  container.append(seed);
  const moreContainer = node("div", { id: "tsuid_83" }); shell.append(moreContainer);
  const more = node("div", { role: "button", "aria-label": moreLabel, "aria-expanded": "false" }); moreContainer.append(more);
  return { owner, shell, seed, more };
}
const hidden = (element: NodeStub) => element.hasAttribute("data-gsb-ai-hidden");
const writes = (element: NodeStub): number => element.writes + element.children.reduce((sum, child) => sum + writes(child), 0);
beforeEach(() => vi.stubGlobal("navigator", { language: "ja" }));
afterEach(() => vi.unstubAllGlobals());

describe("conservative Google AI overrides", () => {
  it("refreshes the English navigation title without replacing its icon or native wrappers", () => {
    const { doc, nav } = setup(); aiLink(nav, "AI Mode");
    vi.stubGlobal("navigator", { language: "en" });
    const overrides = new SearchOverrides(doc);
    const replacement = nav.children[1]!; const icon = replacement.querySelector("img");
    expect(replacement.title).toBe("Google AI Mode replaced with Gemini");
    vi.stubGlobal("navigator", { language: "ja" }); overrides.refreshLanguage();
    expect(replacement.title).toBe("GoogleのAI モードをGeminiに置き換え");
    expect(replacement.querySelector("img")).toBe(icon);
    overrides.stop();
  });
  it("requires the exact navigation label and Google search AI-mode destination", () => {
    const base = "https://www.google.com/search?q=test";
    expect(isAiModeLink(" AI モード ", "/search?q=test&udm=50", base)).toBe(true);
    expect(isAiModeLink("AIモード", "/search?q=test&udm=50", base)).toBe(true);
    expect(isAiModeLink("AI Mode", "https://www.google.co.jp/search?udm=50", base)).toBe(true);
    for (const [label, url] of [
      ["AI Mode", "https://evil.example/search?udm=50"], ["AI Mode", "/search?udm=1"],
      ["画像", "/search?udm=50"], ["Try AI Mode", "/search?udm=50"],
      ["AI Mode", "http://www.google.com/search?udm=50"],
    ]) expect(isAiModeLink(label!, url!, base)).toBe(false);
  });

  it.each(["その他の AI による概要を表示", "Show more AI Overview", "Show more AI Overviews"])(
    "hides the dedicated shell and owned More button for %s, preserving ordinary results", (label) => {
      const { doc, root } = setup();
      const before = node("div", { class: "MjjYud" }); before.append(node("h3", {}, "Before")); root.append(before);
      const { owner, shell, seed } = knownShell(root, label);
      seed.append(node("h3", {}, "AI reference")); seed.append(node("div", { class: "MjjYud" }));
      const after = node("div", { id: "rso" }); after.append(node("h3", {}, "After")); root.append(after);
      const overrides = new SearchOverrides(doc);
      expect(hidden(shell)).toBe(true); expect([owner, seed, before, after].some(hidden)).toBe(false);
      overrides.stop(); expect(hidden(shell)).toBe(false);
    });

  it.each(["search", "rso", "center_col", "rcnt", "hdtb", "gemini-search-bridge-root", "main", "role-main"])(
    "keeps protected %s roots and mixed shells visible", (kind) => {
      const { doc, root } = setup();
      const protectedNode = kind === "main" ? node("main") : kind === "role-main"
        ? node("div", { role: "main" }) : node("div", { id: kind });
      protectedNode.setAttribute("data-attrid", "AIOverview"); root.append(protectedNode);
      const { shell, seed } = knownShell(root);
      const descendant = kind === "main" ? node("main") : kind === "role-main"
        ? node("div", { role: "main" }) : node("div", { id: kind }); shell.append(descendant);
      const overrides = new SearchOverrides(doc);
      expect(hidden(protectedNode)).toBe(false); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true);
      overrides.stop();
    });

  it("does not hide an explicit leaf when it contains protected results or our card", () => {
    const { doc, root } = setup();
    const marker = node("div", { "data-attrid": "AIOverview" }); root.append(marker); marker.append(node("div", { id: "rso" }));
    const { shell, seed } = knownShell(root); seed.append(node("div", { id: "gemini-search-bridge-root" }));
    const overrides = new SearchOverrides(doc); expect([marker, seed, shell].some(hidden)).toBe(false); overrides.stop();
  });

  it.each(["h3", ".MjjYud"])("refuses shell promotion with ordinary %s outside the seed", (selector) => {
    const { doc, root } = setup(); const { shell, seed } = knownShell(root);
    shell.append(selector === "h3" ? node("h3", {}, "Ordinary") : node("div", { class: "MjjYud" }));
    const overrides = new SearchOverrides(doc); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true); overrides.stop();
  });

  it("leaves unknown shells visible and uses the explicit leaf fallback", () => {
    const { doc, root } = setup(); const { shell, seed, more } = knownShell(root); more.setAttribute("aria-label", "Show more");
    const explicit = node("section", { "data-attrid": "ai_overview" }); root.append(explicit);
    const unknown = node("div", { class: "MjjYud" }); root.append(unknown);
    const overrides = new SearchOverrides(doc);
    expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true); expect(hidden(explicit)).toBe(true); expect(hidden(unknown)).toBe(false);
    overrides.stop();
  });

  it("requires an owned More button outside the marker", () => {
    const { doc, root } = setup(); const { shell, seed, more } = knownShell(root); more.remove(); seed.append(more);
    const overrides = new SearchOverrides(doc); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true); overrides.stop();
  });

  it("hides the async variant with lhcontainer and More moved deep inside the shell", () => {
    const { doc, root, notify } = setup(); const { owner, shell, seed, more } = knownShell(root);
    shell.removeAttribute("data-lhcontainer");
    const asyncChild = seed.parent!;
    asyncChild.setAttribute("id", "B2Jtyd");
    asyncChild.setAttribute("data-lhcontainer", "1");
    asyncChild.setAttribute("data-async-type", "folsrch");
    more.remove(); asyncChild.append(more);
    const overrides = new SearchOverrides(doc);
    expect(hidden(shell)).toBe(true); expect(hidden(seed)).toBe(false); expect(hidden(owner)).toBe(false);
    asyncChild.removeAttribute("data-lhcontainer"); notify();
    expect(hidden(shell)).toBe(true);
    overrides.stop(); expect(hidden(shell)).toBe(false);
  });

  it("does not borrow an AI More control from outside the shell", () => {
    const { doc, root } = setup(); const { shell, seed, more } = knownShell(root);
    more.remove(); root.append(more);
    const overrides = new SearchOverrides(doc);
    expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true); expect(hidden(more)).toBe(false);
    overrides.stop();
  });

  it("restores and reapplies shell hiding after identifying boundary attributes change", () => {
    const { doc, root, notify, observe } = setup(); const { shell, seed, more } = knownShell(root);
    const overrides = new SearchOverrides(doc);
    expect(observe.mock.calls[0]![1].attributeFilter).toEqual(expect.arrayContaining(["class", "id", "aria-label", "data-lhcontainer"]));
    for (const [target, attribute, invalid, valid] of [
      [shell, "class", "unknown", "SePcAf"], [shell, "id", "unknown", "eKIzJc"],
      [more, "aria-label", "Show more", "Show more AI overview"],
    ] as const) {
      target.setAttribute(attribute, invalid); notify(); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true);
      target.setAttribute(attribute, valid); notify(); expect(hidden(shell)).toBe(true); expect(hidden(seed)).toBe(false);
    }
    seed.setAttribute("id", "unknown"); notify(); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(false);
    seed.setAttribute("id", "m-x-content"); notify(); expect(hidden(shell)).toBe(true);
    shell.append(node("div", { id: "rso" })); notify(); expect(hidden(shell)).toBe(false); expect(hidden(seed)).toBe(true);
    overrides.stop();
  });

  it("hides late inserted known shells and restores detached or newly protected leaves", () => {
    const { doc, root, notify } = setup(); const overrides = new SearchOverrides(doc);
    const { shell } = knownShell(root); notify(); expect(hidden(shell)).toBe(true);
    shell.remove(); notify(); expect(hidden(shell)).toBe(false);
    const leaf = node("div", { "data-attrid": "AIOverview" }); root.append(leaf); notify(); expect(hidden(leaf)).toBe(true);
    leaf.setAttribute("role", "main"); notify(); expect(hidden(leaf)).toBe(false); overrides.stop();
  });

  it.each(["AIモード", "AI Mode"])("copies only the safe native label shape for %s", (label) => {
    const { doc, root, nav, head, notify } = setup(); const original = aiLink(nav, label);
    original.className = "XVMlrc C6AK7c"; original.textContent = "";
    original.setAttribute("jsaction", "click:google"); original.setAttribute("onclick", "unsafe()"); original.setAttribute("data-ved", "tracking");
    let container = original;
    for (const [tag, className] of [["div", "mXwfNd"], ["div", "mVH5Fc"], ["span", "R1QWuf"], ["span", ""]]) {
      const wrapper = node(tag!, { class: className!, jsname: "KliEFc", jsaction: "click:google", "data-rpc": "native" });
      container.append(wrapper); container = wrapper;
    }
    container.textContent = label;
    const overrides = new SearchOverrides(doc); const replacement = nav.children[1]!;
    expect(replacement).not.toBe(original); expect(replacement.className).toBe("XVMlrc C6AK7c"); expect(replacement.textContent).toBe("Gemini");
    expect(replacement.target).toBe("_blank"); expect(replacement.rel).toBe("noopener noreferrer");
    const wrappers = replacement.querySelectorAll("div, span");
    expect(wrappers.map((element) => [element.tagName, element.className])).toEqual([
      ["DIV", "mXwfNd"], ["DIV", "mVH5Fc"], ["SPAN", "R1QWuf"], ["SPAN", ""], ["SPAN", ""],
    ]);
    expect(wrappers.find((element) => element.hasAttribute("data-gsb-gemini-label"))).toBeDefined();
    const icon = replacement.querySelector("img")!;
    expect(icon.getAttribute("src")).toBe(GEMINI_ICON);
    expect(icon.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(icon.getAttribute("alt")).toBe(""); expect(icon.getAttribute("aria-hidden")).toBe("true");
    for (const element of [replacement, ...wrappers]) {
      for (const attribute of ["onclick", "jsaction", "jsname", "data-ved", "data-rpc"]) expect(element.hasAttribute(attribute)).toBe(false);
    }
    expect(head.children[0]!.textContent).not.toContain("::after"); expect(head.children[0]!.textContent).not.toContain("border-bottom");
    expect(head.children[0]!.textContent).not.toContain("font-weight:700");
    const before = writes(root); notify(); notify(); overrides.setConversationUrl(null); expect(writes(root)).toBe(before);
    original.className = "XVMlrc changed"; container.className = "new-leaf"; notify();
    expect(replacement.className).toBe("XVMlrc changed");
    expect(replacement.querySelector('[data-gsb-gemini-label]')!.className).toBe("new-leaf");
    const changed = writes(root); notify(); expect(writes(root)).toBe(changed); overrides.stop(); expect(nav.children).toEqual([original]);
  });

  it("replaces only AI navigation, sanitizes URLs, recovers removal and restores on stop", () => {
    const { doc, root, head, nav, notify, disconnected } = setup(); const { shell } = knownShell(root);
    const original = aiLink(nav); const ordinary = aiLink(nav, "画像", "https://www.google.com/search?udm=2");
    const overrides = new SearchOverrides(doc);
    expect(original.hasAttribute("data-gsb-ai-replaced")).toBe(true); expect(ordinary.hasAttribute("data-gsb-ai-replaced")).toBe(false);
    expect(doc.querySelectorAll).toHaveBeenCalledWith('#hdtb a[href], nav a[href], [role="navigation"] a[href]');
    const replacement = nav.children[1]!; expect(replacement.textContent).toBe("Gemini"); expect(replacement.href).toBe("https://gemini.google.com/app");
    overrides.setConversationUrl("https://gemini.google.com/app/abc123"); expect(replacement.href).toBe("https://gemini.google.com/app/abc123");
    replacement.remove(); notify(); expect(nav.children).toHaveLength(3); expect(nav.children[1]!.href).toBe("https://gemini.google.com/app/abc123");
    overrides.setConversationUrl("https://evil.example/app/id"); expect(nav.children[1]!.href).toBe("https://gemini.google.com/app");
    const late = aiLink(nav, "AI Mode"); notify(); expect(late.hasAttribute("data-gsb-ai-replaced")).toBe(true);
    original.href = "https://www.google.com/search?udm=2"; notify(); expect(original.hasAttribute("data-gsb-ai-replaced")).toBe(false);
    overrides.stop(); expect(disconnected).toHaveBeenCalledOnce(); expect(head.children).toHaveLength(0); expect(hidden(shell)).toBe(false);
    expect(late.hasAttribute("data-gsb-ai-replaced")).toBe(false); expect(nav.children).toEqual([original, ordinary, late]);
    const stopped = writes(root); notify(); overrides.setConversationUrl("https://gemini.google.com/app/id"); expect(writes(root)).toBe(stopped);
  });
});
