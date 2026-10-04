import type { LoginState } from "../../shared/phase0-messages";

export const GEMINI_SELECTORS = {
  promptInputs: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="プロンプト"]',
    "textarea",
  ],
  sendButtons: [
    'button[aria-label="Send message"]',
    'button[aria-label="メッセージを送信"]',
    'button[aria-label="プロンプトを送信"]',
    'button[aria-label*="送信"]',
    'button[mattooltip="Send message"]',
    'button[aria-label="Submit"]',
    'button[type="submit"]',
    "button.send-button",
  ],
  stopButtons: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]',
    'button[aria-label*="回答を停止"]',
    'button[aria-label*="生成を停止"]',
    'button[aria-label*="停止"]',
    'button[mattooltip="Stop response"]',
    '[data-test-id="stop-button"]',
  ],
  modelResponses: [
    "model-response",
    '[data-test-id="model-response"]',
    ".model-response",
  ],
  answerContents: [
    ".markdown-main-panel",
    ".model-response-text .markdown",
    "message-content .markdown",
    "message-content",
  ],
  newChatButtons: [
    'a[aria-label="チャットを新規作成"]',
    'a[aria-label="新しいチャット"]',
    'button[aria-label="New chat"]',
    'a[aria-label="New chat"]',
    'button[aria-label*="新規チャット"]',
    'a[aria-label*="新規チャット"]',
  ],
  conversationTurns: [
    '[data-test-id="conversation-turn"]',
    "user-query",
    "model-response",
    ".conversation-container user-query",
  ],
  signedOutIndicators: [
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/signin"]',
    'button[aria-label*="Sign in" i]',
    'a[aria-label*="Sign in" i]',
    'button[aria-label*="ログイン"]',
    'a[aria-label*="ログイン"]',
  ],
  captchaIndicators: [
    'iframe[src*="recaptcha" i]',
    'iframe[title*="recaptcha" i]',
    '[data-test-id*="captcha" i]',
    '[data-sitekey]',
    '[aria-label*="captcha" i]',
    '[aria-label*="ロボットではない"]',
  ],
  rateLimitIndicators: [
    '[data-test-id="rate-limit"]',
    '[data-test-id*="rate-limit" i]',
    '[role="alert"][aria-label*="usage limit" i]',
    '[role="alert"][aria-label*="rate limit" i]',
    '[role="alert"][aria-label*="利用上限"]',
  ],
  manualInterventionIndicators: [
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])',
    'dialog[open]',
    '[role="dialog"] [href*="policies.google.com/terms"]',
    '[role="dialog"][aria-label*="terms" i]',
    '[role="dialog"][aria-label*="利用規約"]',
    '[data-test-id*="model-picker" i][aria-expanded="true"]',
  ],
} as const;

export interface SelectorMatch {
  element: Element;
  selector: string;
}

export interface GeminiSurfaceDetection {
  loginState: LoginState;
  promptInput: SelectorMatch | null;
  sendButton: SelectorMatch | null;
}

export interface GeminiBlockingDetection {
  kind: "captcha" | "rate_limit" | "manual_intervention";
  match: SelectorMatch;
}

type QueryRoot = Pick<ParentNode, "querySelector">;

export function findFirstSelector(
  root: QueryRoot,
  selectors: readonly string[],
): SelectorMatch | null {
  for (const selector of selectors) {
    try {
      const element = root.querySelector(selector);

      if (element !== null) {
        return { element, selector };
      }
    } catch {
      // A selector regression must not stop the remaining compatibility probes.
    }
  }

  return null;
}

export function detectGeminiSurface(root: QueryRoot): GeminiSurfaceDetection {
  const promptInput = findFirstSelector(root, GEMINI_SELECTORS.promptInputs);
  const sendButton = findFirstSelector(root, GEMINI_SELECTORS.sendButtons);
  const signedOut = findFirstSelector(
    root,
    GEMINI_SELECTORS.signedOutIndicators,
  );

  const loginState: LoginState = promptInput
    ? "logged_in"
    : signedOut
      ? "logged_out"
      : "unknown";

  return { loginState, promptInput, sendButton };
}

export function detectGeminiBlockingState(
  root: QueryRoot,
): GeminiBlockingDetection | null {
  const captcha = findFirstSelector(root, GEMINI_SELECTORS.captchaIndicators);

  if (captcha) {
    return { kind: "captcha", match: captcha };
  }

  const rateLimit = findFirstSelector(
    root,
    GEMINI_SELECTORS.rateLimitIndicators,
  );

  if (rateLimit) {
    return { kind: "rate_limit", match: rateLimit };
  }

  const manualIntervention = findFirstSelector(
    root,
    GEMINI_SELECTORS.manualInterventionIndicators,
  );
  return manualIntervention
    ? { kind: "manual_intervention", match: manualIntervention }
    : null;
}
