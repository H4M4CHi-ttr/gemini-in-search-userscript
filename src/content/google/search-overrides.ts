import { sanitizeConversationUrl } from "../../shared/conversation-url";
import { GEMINI_ICON } from "../../shared/gemini-icon";
import { translate } from "../../userscript/i18n";

const AI_MODULES = '#m-x-content, [data-attrid="AIOverview"], [data-attrid="ai_overview"]';
const PROTECTED_RESULTS = '#search, #rso, #center_col, #rcnt, #hdtb, main, [role="main"], #gemini-search-bridge-root';
const HIDDEN_MARK = "data-gsb-ai-hidden";
const NAV_MARK = "data-gsb-ai-replaced";
const GEMINI_APP = "https://gemini.google.com/app";

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, " ");

function aiModuleRoot(marker: Element): Element | null {
  if (marker.matches(PROTECTED_RESULTS) || marker.querySelector(PROTECTED_RESULTS)) return null;
  // Google also puts data-lhcontainer on a deep async child, not on this shell.
  const shell = marker.id === "m-x-content" ? marker.closest('#eKIzJc.SePcAf') : null;
  if (!shell || shell.matches(PROTECTED_RESULTS) || shell.querySelector(PROTECTED_RESULTS)) return marker;
  const more = [...shell.querySelectorAll('[role="button"][aria-label]')].some((button) =>
    !marker.contains(button) && /^(?:その他の AI による概要を表示|Show more AI Overviews?)$/i.test(
      normalizeLabel(button.getAttribute("aria-label") ?? "")));
  const ordinaryResults = [...shell.querySelectorAll("h3, .MjjYud")].some((node) => !marker.contains(node));
  return more && !ordinaryResults ? shell : marker;
}

/** Keep Google's visual wrappers without copying its event or RPC attributes. */
function navigationShape(original: HTMLAnchorElement): { tag: string; className: string }[] {
  const label = normalizeLabel(original.textContent ?? "");
  let path: Element[] = [];
  for (const candidate of original.querySelectorAll("div, span")) {
    if (normalizeLabel(candidate.textContent ?? "") !== label) continue;
    const ancestors: Element[] = [];
    let node: Element | null = candidate;
    while (node && node !== original && ["DIV", "SPAN"].includes(node.tagName)) {
      ancestors.unshift(node);
      node = node.parentElement;
    }
    if (node === original && ancestors.length > path.length) path = ancestors;
  }
  return [original, ...path].map((node) => ({ tag: node.tagName.toLowerCase(), className: node.className }));
}

/** Require both Google's AI-mode destination and its exact navigation label. */
export function isAiModeLink(label: string, href: string, base: string): boolean {
  if (!["AI モード", "AIモード", "AI Mode"].includes(normalizeLabel(label))) return false;
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["www.google.com", "www.google.co.jp"].includes(url.hostname) &&
      url.pathname === "/search" && url.searchParams.get("udm") === "50";
  } catch { return false; }
}

export class SearchOverrides {
  private readonly style: HTMLStyleElement;
  private readonly observer: MutationObserver;
  private readonly hidden = new Set<Element>();
  private readonly navigation = new Map<HTMLAnchorElement, { replacement: HTMLAnchorElement; shape: string }>();
  private url = GEMINI_APP;
  private stopped = false;

  constructor(private readonly doc: Document = document) {
    this.style = doc.createElement("style");
    this.style.textContent = `
      [${HIDDEN_MARK}], [${NAV_MARK}] { display:none !important; }
      a[data-gsb-gemini-nav] { color:#70757A !important;
        position:relative; text-decoration:none; }
      a[data-gsb-gemini-nav] [data-gsb-gemini-label] { display:inline-block; position:relative;
        padding-inline-start:24px; color:inherit; font-weight:inherit; }
      a[data-gsb-gemini-nav] img { position:absolute; inset-inline-start:0; top:50%;
        transform:translateY(-50%); width:18px; height:18px; }
      a[data-gsb-gemini-nav]:focus-visible { outline:3px solid #415FC8; outline-offset:3px; }
    `;
    (doc.head ?? doc.documentElement).append(this.style);
    this.refresh();
    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(doc.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["href", "data-attrid", "id", "role", "class", "aria-label", "data-lhcontainer"],
    });
  }

  setConversationUrl(url: string | null): void {
    if (this.stopped) return;
    this.url = sanitizeConversationUrl(url) ?? GEMINI_APP;
    this.refresh();
  }

  refreshLanguage(): void { this.refresh(); }

  private refresh(): void {
    if (this.stopped) return;
    // ponytail: Google has no stable public AI-module selector; leave unknown modules visible.
    const modules = new Set([...this.doc.querySelectorAll(AI_MODULES)].map(aiModuleRoot).filter((module) => module !== null));
    for (const module of this.hidden) {
      if (!modules.has(module)) {
        module.removeAttribute(HIDDEN_MARK);
        this.hidden.delete(module);
      }
    }
    for (const module of modules) {
      if (!module.hasAttribute(HIDDEN_MARK)) {
        module.setAttribute(HIDDEN_MARK, "");
        this.hidden.add(module);
      }
    }
    for (const [original, { replacement }] of this.navigation) {
      if (!original.isConnected || !replacement.isConnected ||
        !isAiModeLink(original.textContent ?? "", original.href, this.doc.baseURI)) {
        original.removeAttribute(NAV_MARK);
        replacement.remove();
        this.navigation.delete(original);
      }
    }
    for (const original of this.doc.querySelectorAll<HTMLAnchorElement>('#hdtb a[href], nav a[href], [role="navigation"] a[href]')) {
      if (original.hasAttribute("data-gsb-gemini-nav") || this.navigation.has(original) ||
        !isAiModeLink(original.textContent ?? "", original.href, this.doc.baseURI)) continue;
      const replacement = this.doc.createElement("a");
      replacement.setAttribute("data-gsb-gemini-nav", "");
      replacement.target = "_blank";
      replacement.rel = "noopener noreferrer";
      original.setAttribute(NAV_MARK, "");
      original.after(replacement);
      this.navigation.set(original, { replacement, shape: "" });
    }
    for (const [original, entry] of this.navigation) {
      const { replacement } = entry;
      const title = translate("GoogleのAI モードをGeminiに置き換え");
      if (replacement.title !== title) replacement.title = title;
      const shape = navigationShape(original);
      const signature = JSON.stringify(shape);
      if (entry.shape !== signature) {
        if (replacement.className !== shape[0]!.className) replacement.className = shape[0]!.className;
        let label: Element | null = null;
        let parent: Element | null = null;
        for (const wrapper of shape.slice(1)) {
          const node = this.doc.createElement(wrapper.tag);
          if (wrapper.className) node.className = wrapper.className;
          if (parent) parent.append(node);
          else label = node;
          parent = node;
        }
        if (!parent) label = parent = this.doc.createElement("span");
        parent.setAttribute("data-gsb-gemini-label", "");
        const icon = this.doc.createElement("img");
        icon.setAttribute("referrerpolicy", "no-referrer");
        icon.setAttribute("src", GEMINI_ICON);
        icon.setAttribute("alt", "");
        icon.setAttribute("aria-hidden", "true");
        const text = this.doc.createElement("span");
        text.textContent = "Gemini";
        parent.replaceChildren(icon, text);
        replacement.replaceChildren(label!);
        entry.shape = signature;
      }
      if (replacement.href !== this.url) replacement.href = this.url;
    }
  }

  stop(): void {
    this.stopped = true;
    this.observer.disconnect();
    this.style.remove();
    for (const module of this.hidden) module.removeAttribute(HIDDEN_MARK);
    for (const [original, { replacement }] of this.navigation) {
      original.removeAttribute(NAV_MARK);
      replacement.remove();
    }
    this.hidden.clear();
    this.navigation.clear();
  }
}
