import { describe, expect, it } from "vitest";
import { SearchQueue, searchSignature } from "../../src/userscript/search-queue";
const search = (query: string) => ({ query, sourceUrl: `https://www.google.com/search?q=${query}`, promptText: `Frozen: ${query}` });
describe("latest search queue", () => {
  it("retains one latest query while the worker is busy", () => {
    const queue = new SearchQueue();
    queue.offer(search("A")); queue.dispatched();
    queue.offer(search("B")); queue.offer(search("C"));
    expect(queue.pending?.query).toBe("C");
    expect(queue.dispatched()?.query).toBe("C");
    expect(queue.pending).toBeNull();
  });
  it("does not replay sent work on polling or page reload", () => {
    const queue = new SearchQueue();
    queue.offer(search("A")); queue.dispatched(); queue.offer(search("A"));
    expect(queue.pending).toBeNull();
    const restored = new SearchQueue(queue.lastDispatched);
    restored.offer({ ...search("A"), sourceUrl: `${search("A").sourceUrl}&sei=telemetry` });
    expect(restored.pending).toBeNull();
  });
  it("drops obsolete pending work when returning to the active search", () => {
    const queue = new SearchQueue(searchSignature(search("A")));
    queue.offer(search("B")); queue.offer(search("A"));
    expect(queue.pending).toBeNull();
    queue.offer(search("C")); queue.offer(null);
    expect(queue.pending).toBeNull();
  });
  it("consumes interrupted work without dropping a different latest query", () => {
    const queue = new SearchQueue();
    queue.offer(search("A")); queue.dispatched(); queue.offer(search("A"));
    expect(queue.pending).toBeNull();
    queue.offer(search("B")); queue.lastDispatched = searchSignature(search("A"));
    expect(queue.pending?.query).toBe("B");
  });

  it("keeps the offered prompt snapshot when the same raw search is offered again", () => {
    const queue = new SearchQueue();
    queue.offer(search("A"));
    queue.offer({ ...search("A"), promptText: "Changed template: A" });
    expect(queue.pending?.promptText).toBe("Frozen: A");
  });
});
