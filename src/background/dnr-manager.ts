export const GEMINI_FRAME_RULE_ID = 10_001;
export const GEMINI_ORIGIN = "https://gemini.google.com";
export const GEMINI_IFRAME_URL = `${GEMINI_ORIGIN}/app`;
export const OFFSCREEN_TAB_ID = -1;

export type FrameRuleScope = "offscreen";

type UpdateSessionRulesOptions = Parameters<
  typeof chrome.declarativeNetRequest.updateSessionRules
>[0];

export interface SessionRuleWriter {
  updateSessionRules(options: UpdateSessionRulesOptions): Promise<void>;
}

export interface SessionRuleStore extends SessionRuleReader, SessionRuleWriter {}

export interface SessionRuleReader {
  getSessionRules(): Promise<chrome.declarativeNetRequest.Rule[]>;
}

export function shouldReleaseFrameRuleOwner(
  activeOwner: string | null,
  cleanupOwner: string | undefined,
): boolean {
  return cleanupOwner !== undefined && activeOwner === cleanupOwner;
}

export function buildGeminiFrameRule(
  extensionId: string,
): chrome.declarativeNetRequest.Rule {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("A valid Chrome extension ID is required.");
  }

  const condition: chrome.declarativeNetRequest.RuleCondition = {
    requestDomains: ["gemini.google.com"],
    resourceTypes: [
      "sub_frame" as chrome.declarativeNetRequest.ResourceType,
    ],
    tabIds: [OFFSCREEN_TAB_ID],
    topDomains: [extensionId],
  };

  return {
    id: GEMINI_FRAME_RULE_ID,
    priority: 100,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: [
        {
          header: "x-frame-options",
          operation:
            "remove" as chrome.declarativeNetRequest.HeaderOperation,
        },
        {
          header: "content-security-policy",
          operation:
            "remove" as chrome.declarativeNetRequest.HeaderOperation,
        },
      ],
    },
    condition,
  };
}

export async function installGeminiFrameRule(
  extensionId: string,
  store: SessionRuleStore = chrome.declarativeNetRequest,
): Promise<chrome.declarativeNetRequest.Rule> {
  const rule = buildGeminiFrameRule(extensionId);
  const existing = (await store.getSessionRules()).find(
    (candidate) => candidate.id === GEMINI_FRAME_RULE_ID,
  );

  if (existing && JSON.stringify(existing) === JSON.stringify(rule)) {
    return rule;
  }

  await store.updateSessionRules({
    removeRuleIds: [GEMINI_FRAME_RULE_ID],
    addRules: [rule],
  });

  return rule;
}

export async function removeGeminiFrameRule(
  store: SessionRuleWriter = chrome.declarativeNetRequest,
): Promise<void> {
  await store.updateSessionRules({
    removeRuleIds: [GEMINI_FRAME_RULE_ID],
  });
}

export async function isGeminiFrameRuleInstalled(
  reader: SessionRuleReader = chrome.declarativeNetRequest,
): Promise<boolean> {
  const rules = await reader.getSessionRules();

  return rules.some((rule) => rule.id === GEMINI_FRAME_RULE_ID);
}
