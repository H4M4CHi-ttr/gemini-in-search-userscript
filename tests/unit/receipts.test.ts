import { describe, expect, it } from "vitest";
import { receipts } from "../../src/userscript/receipts";
import { MAX_JOB_AGE_MS } from "../../src/userscript/protocol";
const now = 1_800_000_000_000;
describe("worker-owned durable acceptance receipts", () => {
  it("retains acceptance when another source overwrites the shared reply", () => {
    const result = receipts({ A: { jobId: "A", sourceTabId: 1, createdAt: now }, B: { jobId: "B", sourceTabId: 2, createdAt: now } }, now);
    expect(result.A?.sourceTabId).toBe(1);
    expect(result.B?.sourceTabId).toBe(2);
  });
  it("does not accept expired, future, malformed or mismatched receipts", () => {
    expect(receipts({ A: { jobId: "A", sourceTabId: 1, createdAt: now } }, now + MAX_JOB_AGE_MS)).toEqual({});
    expect(receipts({ A: { jobId: "B", sourceTabId: 1, createdAt: now }, B: { jobId: "B", sourceTabId: 0, createdAt: now }, C: { jobId: "C", sourceTabId: 2, createdAt: now + 1 } }, now)).toEqual({});
  });
  it("keeps acceptance but drops a reply from another job or source", () => {
    const result = receipts({ A: { jobId: "A", sourceTabId: 1, createdAt: now, reply: { jobId: "B", sourceTabId: 1, status: "generating", updatedAt: now, progressText: "wrong" } } }, now);
    expect(result.A).toEqual({ jobId: "A", sourceTabId: 1, createdAt: now });
  });
});
