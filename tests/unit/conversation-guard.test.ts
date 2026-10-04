import { describe, expect, it } from "vitest";
import { submittedQueryMatches } from "../../src/userscript/conversation-guard";
const turn = (text: string) => ({ textContent: text, querySelector: () => null, querySelectorAll: () => [] }) as unknown as Element;
const root = (texts: string[]) => ({ querySelectorAll: () => texts.map(turn) }) as unknown as Pick<ParentNode, "querySelectorAll">;
const nativeRoot = (texts: string[]) => {
  const lines = texts.map((text) => ({ tagName: "P", className: "query-text-line ng-star-inserted", innerText: text, textContent: text }));
  const label = { tagName: "H5", className: "cdk-visually-hidden screen-reader-user-query-label", innerText: `You said\n${texts.join("\n")}` };
  const queryText = {
    className: "query-text", children: [label, ...lines],
    innerText: `${label.innerText}\n${texts.join("\n")}`,
    querySelectorAll: (selector: string) => selector === ".query-text-line" ? lines : [],
  };
  const content = { className: "query-content", children: [queryText], innerText: queryText.innerText, querySelectorAll: queryText.querySelectorAll };
  const nativeTurn = {
    children: [content], querySelectorAll: content.querySelectorAll,
    querySelector: (selector: string) => selector === ".query-text, .query-content" ? content : null,
  };
  return { querySelectorAll: () => [nativeTurn] } as unknown as Pick<ParentNode, "querySelectorAll">;
};
describe("native conversation job binding", () => {
  it("requires exactly the fresh matching user turn", () => {
    expect(submittedQueryMatches(root(["2+2"]), "2+2")).toBe(true);
    expect(submittedQueryMatches(root(["another chat"]), "2+2")).toBe(false);
    expect(submittedQueryMatches(root([]), "2+2")).toBe(false);
    expect(submittedQueryMatches(root(["2+2", "old"]), "2+2")).toBe(false);
  });
  it("normalizes only outer whitespace and line endings", () => {
    expect(submittedQueryMatches(root(["  A\r\nB  "]), "A\nB")).toBe(true);
    expect(submittedQueryMatches(root(["A B"]), "A\nB")).toBe(false);
  });
  it("reads native paragraphs without the duplicated accessibility label", () => {
    expect(submittedQueryMatches(nativeRoot(["\n2+2\n"]), "2+2")).toBe(true);
    expect(submittedQueryMatches(nativeRoot(["2+2"]), "2")).toBe(false);
    expect(submittedQueryMatches(nativeRoot(["another query"]), "2+2")).toBe(false);
  });
  it("preserves native paragraph breaks, blank lines and internal spaces", () => {
    expect(submittedQueryMatches(nativeRoot(["\nA\n", "\nB\n"]), "A\r\nB")).toBe(true);
    expect(submittedQueryMatches(nativeRoot(["A", "B"]), "A B")).toBe(false);
    expect(submittedQueryMatches(nativeRoot(["A", "", "B"]), "A\n\nB")).toBe(true);
    expect(submittedQueryMatches(nativeRoot(["A", "", "B"]), "A\nB")).toBe(false);
    expect(submittedQueryMatches(nativeRoot(["A  B"]), "A B")).toBe(false);
  });
});
