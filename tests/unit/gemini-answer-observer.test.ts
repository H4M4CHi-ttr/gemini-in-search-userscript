import { describe, expect, it } from "vitest";

import {
  ANSWER_STABLE_MS,
  MINIMUM_GENERATION_MS,
  replaceCumulativeAnswerSnapshot,
  shouldCompleteAnswer,
} from "../../src/content/gemini/gemini-answer-observer";

describe("Gemini answer completion", () => {
  const completedState = {
    text: "Complete synthetic answer",
    stopButtonPresent: false,
    explicitCompletionPresent: false,
    lastChangedAt: 1_000,
    submittedAt: 1_000,
    now: 1_000 + ANSWER_STABLE_MS + MINIMUM_GENERATION_MS,
  };

  it("requires non-empty stable text, no Stop button, and minimum runtime", () => {
    expect(shouldCompleteAnswer(completedState)).toBe(true);
    expect(shouldCompleteAnswer({ ...completedState, text: "" })).toBe(false);
    expect(
      shouldCompleteAnswer({ ...completedState, stopButtonPresent: true }),
    ).toBe(false);
    expect(
      shouldCompleteAnswer({
        ...completedState,
        lastChangedAt: completedState.now - ANSWER_STABLE_MS + 1,
      }),
    ).toBe(false);
    expect(
      shouldCompleteAnswer({
        ...completedState,
        submittedAt: completedState.now - MINIMUM_GENERATION_MS + 1,
      }),
    ).toBe(false);
  });

  it("replaces cumulative snapshots instead of concatenating them", () => {
    expect(replaceCumulativeAnswerSnapshot("Hel", "Hello")).toBe("Hello");
    expect(replaceCumulativeAnswerSnapshot("Hello", "Hello world")).toBe(
      "Hello world",
    );
  });

  it("accepts Gemini's explicit completion marker without a stable timer tick", () => {
    expect(
      shouldCompleteAnswer({
        ...completedState,
        explicitCompletionPresent: true,
        lastChangedAt: completedState.now,
        submittedAt: completedState.now,
      }),
    ).toBe(true);
  });
});
