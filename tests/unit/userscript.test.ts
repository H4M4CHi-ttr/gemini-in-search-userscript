import { describe, expect, it } from "vitest";
import {
  isUserscriptRequest, isUserscriptReply, liveWorker, pendingRequest,
  MAX_JOB_AGE_MS, WORKER_MAX_AGE_MS,
  storedWorker, isFocusRequest, isFocusAck, FOCUS_MAX_AGE_MS,
} from "../../src/userscript/protocol";

const now = 1_800_000_000_000;
const workerId = "11111111-2222-3333-4444-555555555555";
const request = {
  workerId,
  version: 5,
  job: {
    id: "test-job", sourceTabId: 42, query: "2+2", sourceUrl: "https://www.google.com/search?q=2%2B2",
    createdAt: now, mode: "manual", conversationMode: "new_chat", promptMode: "raw",
    promptText: "Search the web and cite your sources: 2+2",
  },
};
const answer = {
  jobId: "test-job", sourceTabId: 42,
  blocks: [{ type: "paragraph", text: "4" }], plainText: "4", links: [], completedAt: now + 1,
};
const reply = { jobId: "test-job", sourceTabId: 42, status: "completed", updatedAt: now + 1, answer };

describe("userscript cross-tab bridge", () => {
  it("accepts requests only for supported Google searches with the matching query", () => {
    expect(isUserscriptRequest(request)).toBe(true);
    expect(isUserscriptRequest({ ...request, job: { ...request.job, query: "3+3" } })).toBe(false);
    expect(isUserscriptRequest({ ...request, job: { ...request.job, sourceUrl: "https://example.com/search?q=2%2B2" } })).toBe(false);
    expect(isUserscriptRequest({ ...request, workerId: "unrelated-window" })).toBe(false);
    expect(isUserscriptRequest({ ...request, version: 3 })).toBe(false);
    expect(isUserscriptRequest({ ...request, version: 4 })).toBe(false);
    expect(isUserscriptRequest({ ...request, version: undefined })).toBe(false);
  });

  it("requires a bounded complete prompt snapshot without silently accepting raw legacy jobs", () => {
    for (const promptText of [undefined, "", "  ", "x".repeat(16_385)]) {
      expect(isUserscriptRequest({ ...request, job: { ...request.job, promptText } })).toBe(false);
    }
    expect(isUserscriptRequest({ ...request, job: { ...request.job, promptText: "x".repeat(16_384) } })).toBe(true);
  });

  it("rejects expired or future requests instead of replaying stored search queries", () => {
    expect(pendingRequest(request, now)).toEqual(request);
    expect(pendingRequest(request, now + MAX_JOB_AGE_MS)).toBeNull();
    expect(pendingRequest(request, now - 1)).toBeNull();
  });

  it("requires a completed structured answer bound to the original job and source", () => {
    expect(isUserscriptReply(reply)).toBe(true);
    expect(isUserscriptReply({ ...reply, answer: undefined })).toBe(false);
    expect(isUserscriptReply({ ...reply, answer: { ...answer, jobId: "other-job" } })).toBe(false);
    expect(isUserscriptReply({ ...reply, answer: { ...answer, sourceTabId: 43 } })).toBe(false);
    expect(isUserscriptReply({ ...reply, answer: { ...answer, links: [{ label: "unsafe", url: "javascript:alert(1)" }] } })).toBe(false);
    expect(isUserscriptReply({ ...reply, conversationUrl: "https://gemini.google.com/app/abc123" })).toBe(true);
    expect(isUserscriptReply({ ...reply, conversationUrl: "https://gemini.google.com/app" })).toBe(false);
    expect(isUserscriptReply({ ...reply, conversationUrl: "https://example.com/app/abc123" })).toBe(false);
  });

  it("accepts bounded status updates without accepting premature answers", () => {
    const status = { ...reply, status: "generating", answer: undefined };
    expect(isUserscriptReply(status)).toBe(true);
    expect(isUserscriptReply({ ...status, answer })).toBe(false);
    expect(isUserscriptReply({ ...status, detail: "x".repeat(501) })).toBe(false);
    expect(isUserscriptReply({ ...status, updatedAt: NaN })).toBe(false);
  });

  it("distinguishes an available window from hidden, busy, or disconnected workers", () => {
    const worker = { id: workerId, seenAt: now, visible: true, busy: false };
    expect(liveWorker(worker, now)).toEqual(worker);
    expect(liveWorker({ ...worker, visible: false }, now)?.visible).toBe(false);
    expect(liveWorker({ ...worker, busy: true }, now)?.busy).toBe(true);
    expect(liveWorker({ ...worker, visible: false, pipReady: true }, now)).toMatchObject({ visible: false, pipReady: true });
    expect(storedWorker({ ...worker, pipReady: "yes" })).toBeNull();
    expect(liveWorker(worker, now + WORKER_MAX_AGE_MS + 1)).toBeNull();
    expect(liveWorker(worker, now - 1)).toBeNull();
  });

  it("accepts bounded cumulative text only while generating", () => {
    const progress = { ...reply, status: "generating", answer: undefined, progressText: "Partial <script>text</script>" };
    expect(isUserscriptReply(progress)).toBe(true);
    expect(isUserscriptReply({ ...progress, progressText: "x".repeat(200_001) })).toBe(false);
    expect(isUserscriptReply({ ...reply, progressText: "leftover" })).toBe(false);
    expect(isUserscriptReply({ ...progress, status: "failed" })).toBe(false);
  });

  it("keeps a valid stale worker identifiable for recovery without treating it as live", () => {
    const worker = { id: workerId, seenAt: now - 60_000, visible: false, busy: true };
    expect(storedWorker(worker)).toEqual(worker);
    expect(liveWorker(worker, now)).toBeNull();
    expect(storedWorker({ ...worker, seenAt: NaN })).toBeNull();
  });

  it("expires focus commands and requires a correlated, checked acknowledgement", () => {
    const command = { workerId, nonce: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", createdAt: now };
    expect(isFocusRequest(command, now)).toBe(true);
    expect(isFocusRequest(command, now + FOCUS_MAX_AGE_MS)).toBe(false);
    expect(isFocusRequest(command, now - 1)).toBe(false);
    expect(isFocusRequest({ ...command, nonce: "wrong" }, now)).toBe(false);
    const ack = { ...command, checkedAt: now + 100, visible: true, hasFocus: true };
    expect(isFocusAck(ack, now + 100)).toBe(true);
    expect(isFocusAck({ ...ack, checkedAt: now - 1 }, now + 100)).toBe(false);
    expect(isFocusAck({ ...ack, hasFocus: undefined }, now + 100)).toBe(false);
  });
});
