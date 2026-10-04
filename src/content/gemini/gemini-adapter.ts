import {
  detectGeminiBlockingState,
  detectGeminiSurface,
  findFirstSelector,
  GEMINI_SELECTORS,
  type SelectorMatch,
} from "./gemini-selectors";
import type { LoginState } from "./gemini-selectors";

const READY_TIMEOUT_MS = 20_000;
const NEW_CHAT_TIMEOUT_MS = 8_000;
const SEND_BUTTON_TIMEOUT_MS = 3_000;
const SUBMISSION_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

export type GeminiAdapterErrorCode =
  | "not_logged_in"
  | "selector_not_found"
  | "manual_intervention"
  | "rate_limited"
  | "timed_out"
  | "failed";

export class GeminiAdapterError extends Error {
  constructor(
    readonly code: GeminiAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeminiAdapterError";
  }
}

function abortError(): DOMException {
  return new DOMException("The Gemini operation was cancelled.", "AbortError");
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function throwIfAutomationBlocked(): void {
  const blocked = detectGeminiBlockingState(document);

  if (blocked?.kind === "captcha") {
    throw new GeminiAdapterError(
      "manual_intervention",
      `CAPTCHA detected at ${blocked.match.selector}. Automatic operation stopped; complete the check in Gemini.`,
    );
  }

  if (blocked?.kind === "rate_limit") {
    throw new GeminiAdapterError(
      "rate_limited",
      `Gemini usage limit detected at ${blocked.match.selector}. Automatic retry is disabled.`,
    );
  }

  if (blocked?.kind === "manual_intervention") {
    throw new GeminiAdapterError(
      "manual_intervention",
      `A Gemini terms, model, or modal confirmation is blocking automation at ${blocked.match.selector}. Complete it manually.`,
    );
  }
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal);

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      window.clearTimeout(timeoutId);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitFor<T>(
  read: () => T | null,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    assertNotAborted(signal);
    throwIfAutomationBlocked();
    const value = read();

    if (value !== null) {
      return value;
    }

    await wait(POLL_INTERVAL_MS, signal);
  }

  return null;
}

function promptElement(match: SelectorMatch): HTMLElement | HTMLTextAreaElement {
  if (
    match.element instanceof HTMLElement ||
    match.element instanceof HTMLTextAreaElement
  ) {
    return match.element;
  }

  throw new GeminiAdapterError(
    "selector_not_found",
    "The detected Gemini prompt input is not editable.",
  );
}

function readPromptValue(element: HTMLElement | HTMLTextAreaElement): string {
  return element instanceof HTMLTextAreaElement
    ? element.value
    : (element.textContent ?? "");
}

function dispatchInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text,
    }),
  );
}

function setTextareaValue(element: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  if (setter) {
    setter.call(element, text);
  } else {
    element.value = text;
  }

  dispatchInput(element, text);
}

function replaceContentEditableText(element: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;

  try {
    document.execCommand("selectAll", false);
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }

  if (!inserted || readPromptValue(element) !== text) {
    element.textContent = text;
    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(element);
    fallbackRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(fallbackRange);
  }

  dispatchInput(element, text);
}

function isEnabledButton(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  return !(element instanceof HTMLButtonElement) || !element.disabled;
}

function findEnabledSendButton(): HTMLElement | null {
  for (const selector of GEMINI_SELECTORS.sendButtons) {
    let candidates: NodeListOf<Element>;

    try {
      candidates = document.querySelectorAll(selector);
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      if (isEnabledButton(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function hasConversation(): boolean {
  return (
    location.pathname !== "/app" ||
    findFirstSelector(document, GEMINI_SELECTORS.conversationTurns) !== null
  );
}

function submissionStarted(prompt: HTMLElement | HTMLTextAreaElement): boolean {
  return (
    readPromptValue(prompt).trim().length === 0 ||
    findFirstSelector(document, GEMINI_SELECTORS.stopButtons) !== null ||
    findFirstSelector(document, GEMINI_SELECTORS.conversationTurns) !== null ||
    location.pathname !== "/app"
  );
}

export class Phase2GeminiAdapter {
  async waitUntilReady(signal: AbortSignal): Promise<void> {
    throwIfAutomationBlocked();
    const detection = await waitFor(() => {
      const current = detectGeminiSurface(document);
      return current.promptInput || current.loginState === "logged_out"
        ? current
        : null;
    }, READY_TIMEOUT_MS, signal);

    if (detection === null) {
      throw new GeminiAdapterError(
        "timed_out",
        "Gemini did not expose a prompt input before the timeout.",
      );
    }

    if (detection.loginState === "logged_out") {
      throw new GeminiAdapterError(
        "not_logged_in",
        "Gemini requires the user to sign in.",
      );
    }
  }

  getLoginState(): LoginState {
    return detectGeminiSurface(document).loginState;
  }

  async startNewChat(signal: AbortSignal): Promise<void> {
    assertNotAborted(signal);
    throwIfAutomationBlocked();

    if (!hasConversation()) {
      return;
    }

    const newChat = findFirstSelector(document, GEMINI_SELECTORS.newChatButtons);

    if (!(newChat?.element instanceof HTMLElement)) {
      throw new GeminiAdapterError(
        "manual_intervention",
        "A new Gemini chat could not be started automatically.",
      );
    }

    newChat.element.click();
    const ready = await waitFor(() => {
      const detection = detectGeminiSurface(document);
      return !hasConversation() && detection.promptInput ? true : null;
    }, NEW_CHAT_TIMEOUT_MS, signal);

    if (!ready) {
      throw new GeminiAdapterError(
        "timed_out",
        "Gemini did not finish opening a new chat.",
      );
    }
  }

  async fillPrompt(text: string, signal: AbortSignal): Promise<void> {
    throwIfAutomationBlocked();
    const match = await waitFor(
      () => detectGeminiSurface(document).promptInput,
      READY_TIMEOUT_MS,
      signal,
    );

    if (match === null) {
      throw new GeminiAdapterError(
        "selector_not_found",
        "Gemini prompt input was not found.",
      );
    }

    const element = promptElement(match);
    element.focus();

    if (element instanceof HTMLTextAreaElement) {
      setTextareaValue(element, text);
    } else {
      replaceContentEditableText(element, text);
    }

    if (readPromptValue(element) !== text) {
      throw new GeminiAdapterError(
        "selector_not_found",
        "Gemini prompt input did not retain the inserted text.",
      );
    }
  }

  async submit(signal: AbortSignal): Promise<void> {
    throwIfAutomationBlocked();
    const promptMatch = detectGeminiSurface(document).promptInput;

    if (promptMatch === null) {
      throw new GeminiAdapterError(
        "selector_not_found",
        "Gemini prompt input was not found before submission.",
      );
    }

    const prompt = promptElement(promptMatch);
    const sendButton = await waitFor(
      findEnabledSendButton,
      SEND_BUTTON_TIMEOUT_MS,
      signal,
    );

    if (sendButton) {
      sendButton.click();
    } else {
      prompt.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          composed: true,
        }),
      );
      prompt.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          composed: true,
        }),
      );
    }

    const submitted = await waitFor(
      () => (submissionStarted(prompt) ? true : null),
      SUBMISSION_TIMEOUT_MS,
      signal,
    );

    if (!submitted) {
      throw new GeminiAdapterError(
        "manual_intervention",
        "The prompt is filled, but Gemini did not confirm submission.",
      );
    }
  }
}
