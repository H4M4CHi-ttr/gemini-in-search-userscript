/** A native user turn must match this job before its route can be attributed. */
export function submittedQueryMatches(root: Pick<ParentNode, "querySelectorAll">, query: string): boolean {
  const turns = Array.from(root.querySelectorAll("user-query"));
  if (turns.length !== 1) return false;
  const turn = turns[0]!;
  const normalize = (value: string): string => value.replace(/\r\n?/g, "\n").trim();
  const readText = (element: Element): string => (element as HTMLElement).innerText ?? element.textContent ?? "";
  const lines = Array.from(turn.querySelectorAll(".query-text-line"));
  // Native paragraphs wrap their text in formatting whitespace; empty paragraphs retain query line breaks.
  const actual = lines.length ? lines.map((line) => normalize(readText(line))).join("\n") :
    readText(turn.querySelector(".query-text, .query-content") ?? turn);
  return normalize(actual) === normalize(query);
}
