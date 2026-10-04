import { describe, expect, it } from "vitest";

import {
  detectGeminiBlockingState,
  detectGeminiSurface,
  findFirstSelector,
} from "../../src/content/gemini/gemini-selectors";

function fakeRoot(matches: Record<string, Element>): Pick<ParentNode, "querySelector"> {
  return {
    querySelector(selectors: string): Element | null {
      return matches[selectors] ?? null;
    },
  };
}

describe("Gemini surface detection", () => {
  it("returns the first compatible selector", () => {
    const element = {} as Element;
    const root = fakeRoot({ second: element });

    expect(findFirstSelector(root, ["first", "second", "third"])).toEqual({
      element,
      selector: "second",
    });
  });

  it("treats a detected prompt input as a logged-in Gemini session", () => {
    const input = {} as Element;
    const send = {} as Element;
    const root = fakeRoot({
      'rich-textarea .ql-editor[contenteditable="true"]': input,
      'button[aria-label="Send message"]': send,
    });

    const detection = detectGeminiSurface(root);

    expect(detection.loginState).toBe("logged_in");
    expect(detection.promptInput?.element).toBe(input);
    expect(detection.sendButton?.element).toBe(send);
  });

  it("reports logged out only when a sign-in surface is present", () => {
    const root = fakeRoot({
      'a[href*="accounts.google.com/ServiceLogin"]': {} as Element,
    });

    expect(detectGeminiSurface(root).loginState).toBe("logged_out");
    expect(detectGeminiSurface(fakeRoot({})).loginState).toBe("unknown");
  });

  it("detects CAPTCHA before rate limits and reports the matched selector", () => {
    const captchaRoot = fakeRoot({
      'iframe[title*="recaptcha" i]': {} as Element,
      '[data-test-id="rate-limit"]': {} as Element,
    });
    const rateLimitRoot = fakeRoot({
      '[data-test-id="rate-limit"]': {} as Element,
    });

    expect(detectGeminiBlockingState(captchaRoot)).toMatchObject({
      kind: "captcha",
      match: { selector: 'iframe[title*="recaptcha" i]' },
    });
    expect(detectGeminiBlockingState(rateLimitRoot)).toMatchObject({
      kind: "rate_limit",
      match: { selector: '[data-test-id="rate-limit"]' },
    });
    expect(detectGeminiBlockingState(fakeRoot({}))).toBeNull();
  });

  it("stops for terms or model-picker modals as manual intervention", () => {
    const termsDialog = fakeRoot({
      '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])':
        {} as Element,
    });
    const modelPicker = fakeRoot({
      '[data-test-id*="model-picker" i][aria-expanded="true"]': {} as Element,
    });

    expect(detectGeminiBlockingState(termsDialog)).toMatchObject({
      kind: "manual_intervention",
      match: {
        selector:
          '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])',
      },
    });
    expect(detectGeminiBlockingState(modelPicker)).toMatchObject({
      kind: "manual_intervention",
      match: {
        selector: '[data-test-id*="model-picker" i][aria-expanded="true"]',
      },
    });
  });
});
