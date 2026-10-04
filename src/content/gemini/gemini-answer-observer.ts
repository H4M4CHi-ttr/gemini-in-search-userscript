import { findAnswerContent } from "./gemini-extractor";
import {
  detectGeminiBlockingState,
  GEMINI_SELECTORS,
} from "./gemini-selectors";

export const ANSWER_TIMEOUT_MS = 180_000;
export const ANSWER_STABLE_MS = 1_000;
export const MINIMUM_GENERATION_MS = 500;
const COMPLETION_POLL_MS = 100;

export interface AnswerBaseline {
  nodes: readonly Element[];
  lastText: string;
}

export interface AnswerCompletionState {
  text: string;
  stopButtonPresent: boolean;
  explicitCompletionPresent: boolean;
  lastChangedAt: number;
  submittedAt: number;
  now: number;
}

export type AnswerObserverCheckpoint =
  | "observer_installed"
  | "mutation_received"
  | "answer_candidate_found"
  | "completion_marker_found";

export interface AnswerObserverTraceState {
  mutationCount: number;
  candidateCount: number;
  answerLength: number;
}

export type AnswerObserverTrace = (
  checkpoint: AnswerObserverCheckpoint,
  state: AnswerObserverTraceState,
) => void;

export interface AnswerObserverOptions {
  onText?: (text: string) => void;
  pauseWhenHidden?: boolean;
  deadlineAt?: number;
  isSurfaceVisible?: () => boolean;
}

type SelectorRoot = Pick<ParentNode, "querySelector" | "querySelectorAll">;

export class AnswerObserverError extends Error {
  constructor(
    readonly code: "timed_out" | "manual_intervention" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "AnswerObserverError";
  }
}

function responseNodes(root: SelectorRoot): Element[] {
  const matches: Element[] = [];
  const seen = new Set<Element>();

  for (const selector of GEMINI_SELECTORS.modelResponses) {
    try {
      for (const element of root.querySelectorAll(selector)) {
        if (!seen.has(element)) {
          seen.add(element);
          matches.push(element);
        }
      }
    } catch {
      // Keep probing the remaining compatibility selectors.
    }
  }

  return matches;
}

function responseText(response: Element | undefined): string {
  if (!response) {
    return "";
  }

  return (findAnswerContent(response)?.textContent ?? "").trim();
}

function hasExplicitCompletion(response: Element | null): boolean {
  if (!response) {
    return false;
  }

  const content = findAnswerContent(response);
  return (
    content?.getAttribute("aria-busy") === "false" ||
    response.querySelector(".response-footer.complete") !== null
  );
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true;
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function hasVisibleStopButton(root: SelectorRoot): boolean {
  for (const selector of GEMINI_SELECTORS.stopButtons) {
    try {
      for (const element of root.querySelectorAll(selector)) {
        if (isVisible(element)) {
          return true;
        }
      }
    } catch {
      // Keep probing the remaining compatibility selectors.
    }
  }

  return false;
}

function findCandidate(
  currentNodes: Element[],
  baseline: AnswerBaseline,
): Element | null {
  const newNode = currentNodes.find((node) => !baseline.nodes.includes(node));

  if (newNode) {
    return currentNodes.at(-1) ?? newNode;
  }

  const lastNode = currentNodes.at(-1);
  return lastNode && responseText(lastNode) !== baseline.lastText
    ? lastNode
    : null;
}

export function captureAnswerBaseline(root: SelectorRoot): AnswerBaseline {
  const nodes = responseNodes(root);
  return {
    nodes,
    lastText: responseText(nodes.at(-1)),
  };
}

export function replaceCumulativeAnswerSnapshot(
  _previous: string,
  current: string,
): string {
  return current;
}

export function shouldCompleteAnswer(state: AnswerCompletionState): boolean {
  return (
    state.text.trim().length > 0 &&
    !state.stopButtonPresent &&
    (state.explicitCompletionPresent ||
      (state.now - state.submittedAt >= MINIMUM_GENERATION_MS &&
        state.now - state.lastChangedAt >= ANSWER_STABLE_MS))
  );
}

function abortError(): DOMException {
  return new DOMException("Answer observation was cancelled.", "AbortError");
}

export function observeAnswerCompletion(
  root: Document,
  baseline: AnswerBaseline,
  submittedAt: number,
  signal: AbortSignal,
  trace?: AnswerObserverTrace,
  options: AnswerObserverOptions = {},
): Promise<Element> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let candidate: Element | null = null;
    let snapshot = "";
    let lastChangedAt = submittedAt;
    let needsDomRead = true;
    let mutationCount = 0;
    let candidateCount = 0;
    let candidateReported = false;
    let completionReported = false;
    let wasReadable = true;
    const deadlineAt = options.deadlineAt ?? Date.now() + ANSWER_TIMEOUT_MS;

    const report = (checkpoint: AnswerObserverCheckpoint): void => {
      trace?.(checkpoint, {
        mutationCount,
        candidateCount,
        answerLength: snapshot.length,
      });
    };

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      observer.disconnect();
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      root.removeEventListener("visibilitychange", onVisibility);

      if (error) {
        reject(error);
      } else if (candidate) {
        resolve(candidate);
      } else {
        reject(new Error("Gemini answer completed without a response node."));
      }
    };

    const evaluate = (): void => {
      if (settled) {
        return;
      }

      if (Date.now() >= deadlineAt) {
        finish(new AnswerObserverError("timed_out", "Gemini answer observation reached its deadline."));
        return;
      }
      if (options.pauseWhenHidden && !(options.isSurfaceVisible?.() ?? root.visibilityState === "visible")) {
        wasReadable = false;
        return;
      }
      if (!wasReadable) {
        wasReadable = true;
        needsDomRead = true;
        lastChangedAt = Date.now();
      }

      if (!needsDomRead && candidate === null) {
        return;
      }

      const blocked = detectGeminiBlockingState(root);

      if (blocked) {
        finish(
          new AnswerObserverError(
            blocked.kind === "captcha"
              ? "manual_intervention"
              : blocked.kind === "rate_limit"
                ? "rate_limited"
                : "manual_intervention",
            blocked.kind === "captcha"
              ? `CAPTCHA detected at ${blocked.match.selector}. Automatic operation stopped.`
              : blocked.kind === "rate_limit"
                ? `Gemini usage limit detected at ${blocked.match.selector}. Automatic retry is disabled.`
                : `A Gemini terms, model, or modal confirmation requires manual attention at ${blocked.match.selector}.`,
          ),
        );
        return;
      }

      needsDomRead = false;

      const currentNodes = responseNodes(root);
      candidateCount = currentNodes.length;
      const nextCandidate = findCandidate(currentNodes, baseline);
      let candidateFoundNow = false;

      if (nextCandidate) {
        candidate = nextCandidate;

        if (!candidateReported) {
          candidateReported = true;
          candidateFoundNow = true;
        }
      }

      const currentText = responseText(candidate ?? undefined);

      if (currentText !== snapshot) {
        snapshot = replaceCumulativeAnswerSnapshot(snapshot, currentText);
        lastChangedAt = Date.now();
        options.onText?.(snapshot);
      }

      if (candidateFoundNow) {
        report("answer_candidate_found");
      }

      const now = Date.now();
      const explicitCompletionPresent = hasExplicitCompletion(candidate);

      if (explicitCompletionPresent && !completionReported) {
        completionReported = true;
        report("completion_marker_found");
      }

      if (
        candidate &&
        shouldCompleteAnswer({
          text: snapshot,
          stopButtonPresent: hasVisibleStopButton(root),
          explicitCompletionPresent,
          lastChangedAt,
          submittedAt,
          now,
        })
      ) {
        finish();
      }
    };

    const onAbort = (): void => finish(abortError());
    const onVisibility = (): void => {
      needsDomRead = true;
      lastChangedAt = Date.now();
      evaluate();
    };
    const observer = new MutationObserver(() => {
      mutationCount += 1;
      report("mutation_received");
      needsDomRead = true;
      evaluate();
    });
    const intervalId = window.setInterval(evaluate, COMPLETION_POLL_MS);
    const timeoutId = window.setTimeout(
      () => {
        needsDomRead = true;
        evaluate();

        if (!settled) {
          finish(
            new AnswerObserverError(
              "timed_out",
              "Gemini answer observation reached the 180 second timeout.",
            ),
          );
        }
      },
      Math.max(0, deadlineAt - Date.now()),
    );

    if (signal.aborted) {
      finish(abortError());
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    if (options.pauseWhenHidden) root.addEventListener("visibilitychange", onVisibility);
    observer.observe(root.body ?? root.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "class"],
    });
    candidateCount = options.pauseWhenHidden && !(options.isSurfaceVisible?.() ?? root.visibilityState === "visible")
      ? 0 : responseNodes(root).length;
    report("observer_installed");
    evaluate();
  });
}
