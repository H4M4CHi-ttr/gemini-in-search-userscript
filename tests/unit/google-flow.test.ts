import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGoogle } from "../../src/userscript/google-flow";
import { MAX_JOB_AGE_MS, WORKER_MAX_AGE_MS, RECEIPTS_KEY, REPLY_KEY, REQUEST_KEY, SETTINGS_KEY, WORKER_KEY, FOCUS_KEY, FOCUS_ACK_KEY,
  type UserscriptReply, type UserscriptRequest } from "../../src/userscript/protocol";
import { writeReceipt } from "../../src/userscript/receipts";
import { PREFERENCES_KEY } from "../../src/userscript/preferences";

const ui = vi.hoisted(() => ({ cards: [] as { render: ReturnType<typeof vi.fn>; onOpen: () => void; onRetry: (() => void) | undefined }[], changes: [] as (() => void)[] }));
vi.mock("../../src/content/google/card-view", () => ({ SearchCardView: class {
  render = vi.fn();
  constructor(readonly onOpen: () => void, readonly onRetry: (() => void) | undefined = undefined) { ui.cards.push(this); }
  mount() {}
} }));
vi.mock("../../src/content/google/search-overrides", () => ({ SearchOverrides: class { setConversationUrl = vi.fn(); refreshLanguage = vi.fn(); } }));
vi.mock("../../src/content/google/query-observer", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/content/google/query-observer")>(),
  observeGoogleQuery: (change: () => void) => { ui.changes.push(change); return () => {}; },
}));

const workerId = "00000000-0000-4000-8000-000000000001";
const initialTime = 1_800_000_000_000;
let store: Map<string, unknown>;
let listeners: Map<string, ((key: string, previous: unknown, value: unknown, remote: boolean) => void)[]>;
let writes: ReturnType<typeof vi.fn>;
let staleSlotRead: boolean;
const searchUrl = (query: string) => "https://www.google.com/search?q=" + encodeURIComponent(query);
const requests = () => writes.mock.calls.filter(([key]) => key === REQUEST_KEY).map(([, value]) => value as UserscriptRequest);
const request = () => store.get(REQUEST_KEY) as UserscriptRequest;
function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener(key, undefined, store.get(key), true);
}
function readyWorker(): void {
  store.set(WORKER_KEY, { id: workerId, seenAt: Date.now(), visible: false, busy: false, pipReady: true, protocolVersion: 5 });
  notify(WORKER_KEY);
}
function changeQuery(query: string, source = 0): void {
  vi.stubGlobal("location", new URL(searchUrl(query)));
  ui.changes[source]!();
}
function completed(job: UserscriptRequest["job"]): UserscriptReply {
  return { jobId: job.id, sourceTabId: job.sourceTabId, status: "completed", updatedAt: Date.now(),
    conversationUrl: "https://gemini.google.com/app/0123456789abcdef",
    answer: { jobId: job.id, sourceTabId: job.sourceTabId, plainText: "answer", blocks: [{ type: "paragraph", text: "answer" }], links: [], completedAt: Date.now() } };
}
function reloadDocument(query = "original"): void {
  const now = Date.now();
  vi.clearAllTimers(); vi.setSystemTime(now);
  listeners.clear(); ui.cards.length = 0; ui.changes.length = 0;
  vi.stubGlobal("document", { readyState: "complete", getElementById: () => null });
  vi.stubGlobal("location", new URL(searchUrl(query)));
}
async function completeSource(tab: Record<string, unknown>): Promise<UserscriptReply> {
  await startGoogle(tab);
  const terminal = completed(request().job);
  writeReceipt(request().job, terminal);
  store.delete(REQUEST_KEY);
  notify(RECEIPTS_KEY);
  expect(tab.gsbV4ActiveJob).toBeNull();
  expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({
    answer: terminal.answer, conversationUrl: terminal.conversationUrl,
  }));
  return terminal;
}
async function failSource(tab: Record<string, unknown>): Promise<UserscriptRequest> {
  await startGoogle(tab);
  const original = request();
  writeReceipt(original.job, { jobId: original.job.id, sourceTabId: original.job.sourceTabId,
    status: "selector_not_found", updatedAt: Date.now(), detail: "Geminiの入力欄を確認してください。" });
  store.delete(REQUEST_KEY);
  notify(RECEIPTS_KEY);
  expect(tab.gsbV4ActiveJob).toBeNull();
  expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ canRetry: true }));
  return original;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  ui.cards.length = 0; ui.changes.length = 0;
  store = new Map([[SETTINGS_KEY, { version: 4, consentAccepted: true }]]);
  listeners = new Map(); staleSlotRead = false;
  writes = vi.fn((key: string, value: unknown) => store.set(key, structuredClone(value)));
  vi.stubGlobal("GM_getValue", (key: string, fallback: unknown) => key === REQUEST_KEY && staleSlotRead ? fallback : store.get(key) ?? fallback);
  vi.stubGlobal("GM_setValue", writes);
  vi.stubGlobal("GM_deleteValue", (key: string) => store.delete(key));
  vi.stubGlobal("GM_saveTab", vi.fn());
  vi.stubGlobal("GM_addValueChangeListener", (key: string, listener: (key: string, previous: unknown, value: unknown, remote: boolean) => void) => {
    listeners.set(key, [...listeners.get(key) ?? [], listener]); return listeners.size;
  });
  vi.stubGlobal("document", { readyState: "complete", getElementById: () => null });
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: vi.fn() });
  vi.stubGlobal("location", new URL(searchUrl("original")));
  readyWorker();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("actual Google flow storage recovery", () => {
  it("freezes the offered prompt across preference changes, polling and a source document reload", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    store.set(WORKER_KEY, { ...store.get(WORKER_KEY) as object, busy: true });
    store.set(PREFERENCES_KEY, { version: 1, language: "en", promptTemplate: "Original: %%prompt%%" });
    await startGoogle(tab);
    expect(tab.gsbV5PendingSearch).toEqual(expect.objectContaining({ promptText: "Original: original" }));
    expect(requests()).toHaveLength(0);
    store.set(PREFERENCES_KEY, { version: 1, language: "ja", promptTemplate: "Changed: %%prompt%%" });
    notify(PREFERENCES_KEY);
    vi.advanceTimersByTime(3_000);
    reloadDocument();
    await startGoogle(tab);
    readyWorker();
    expect(request().version).toBe(5);
    expect(request().job).toEqual(expect.objectContaining({ query: "original", promptText: "Original: original" }));
    expect(requests()).toHaveLength(1);
  });

  it("reoffers the identical prompt and job id after source reload while preference values change", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    store.set(PREFERENCES_KEY, { version: 1, language: "en", promptTemplate: "Original: %%prompt%%" });
    await startGoogle(tab);
    const original = structuredClone(request());
    store.delete(REQUEST_KEY);
    store.set(PREFERENCES_KEY, { version: 1, language: "ja", promptTemplate: "Changed: %%prompt%%" });
    reloadDocument();
    await startGoogle(tab);
    expect(request()).toEqual(original);
    expect(requests()).toHaveLength(2);
  });

  it("takes the current template only for an explicit retry, preserving its consumed signature and old receipt", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    store.set(PREFERENCES_KEY, { version: 1, language: "en", promptTemplate: "Original: %%prompt%%" });
    const original = await failSource(tab);
    const receipt = structuredClone(store.get(RECEIPTS_KEY));
    const signature = tab.gsbV4LastDispatched;
    store.set(PREFERENCES_KEY, { version: 1, language: "ja", promptTemplate: "Changed: %%prompt%%" });
    notify(PREFERENCES_KEY);
    expect(requests()).toHaveLength(1);
    ui.cards[0]!.onRetry!();
    expect(request().job.promptText).toBe("Changed: original");
    expect(request().job.id).not.toBe(original.job.id);
    expect(tab.gsbV4LastDispatched).toBe(signature);
    expect(store.get(RECEIPTS_KEY)).toEqual(receipt);
  });

  it("rejects a v4 owner on both the initial dispatch and unacknowledged reoffer paths", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = structuredClone(request());
    store.delete(REQUEST_KEY);
    store.set(WORKER_KEY, { ...store.get(WORKER_KEY) as object, protocolVersion: 4 });
    notify(WORKER_KEY);
    vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(1);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ pipReady: false, detail: expect.stringMatching(/再読み込み/) }));
    reloadDocument();
    await startGoogle(tab);
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4ActiveJob).toEqual(original.job);
    const freshTab = { gsbSourceTabId: 2 } as Record<string, unknown>;
    await startGoogle(freshTab);
    expect(requests()).toHaveLength(1);
  });

  it.each(["completed", "generating", "no receipt"])("does not replay a legacy raw active job: %s", async (phase) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = structuredClone(request());
    const { promptText: _promptText, ...legacy } = original.job;
    tab.gsbV4ActiveJob = legacy;
    delete tab.gsbV4LastJob;
    if (phase === "completed") writeReceipt(legacy, completed(original.job));
    else if (phase === "generating") writeReceipt(legacy, { jobId: legacy.id, sourceTabId: 1, status: "generating", updatedAt: Date.now(), progressText: "legacy partial" });
    store.delete(REQUEST_KEY);
    reloadDocument();
    await startGoogle(tab);
    expect(tab.gsbV4ActiveJob).toBeNull();
    expect(tab.gsbV4LastDispatched).toBe("https://www.google.com/search\noriginal");
    readyWorker(); vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(1);
    if (phase === "completed") expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ answer: expect.objectContaining({ jobId: legacy.id, plainText: "answer" }) }));
    else expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ canRetry: true, detail: expect.stringMatching(/自動再送信しません/) }));
  });

  it("passes live PiP readiness to the card before any answer is received", async () => {
    await startGoogle({ gsbSourceTabId: 1 });
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({
      pipReady: true, status: "Geminiに送信しています…",
    }));
    expect(requests()).toHaveLength(1);
  });

  it.each(["closed PiP", "stale worker", "missing worker", "old protocol", "missing consent"])(
    "does not mark the card PiP-ready with %s", async (state) => {
      await startGoogle({ gsbSourceTabId: 1 });
      const worker = store.get(WORKER_KEY) as Record<string, unknown>;
      if (state === "closed PiP") store.set(WORKER_KEY, { ...worker, pipReady: false });
      if (state === "stale worker") store.set(WORKER_KEY, { ...worker, seenAt: Date.now() - 20_001 });
      if (state === "missing worker") store.delete(WORKER_KEY);
      if (state === "old protocol") store.set(WORKER_KEY, { ...worker, protocolVersion: 3 });
      if (state === "missing consent") store.set(SETTINGS_KEY, { version: 4, consentAccepted: false });
      notify(state === "missing consent" ? SETTINGS_KEY : WORKER_KEY);
      expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ pipReady: false }));
      expect(requests()).toHaveLength(1);
    });

  it("retries a terminal failure once under a new manual id while retaining its receipt and consumed signature", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    const original = await failSource(tab);
    const receipts = structuredClone(store.get(RECEIPTS_KEY));
    const signature = tab.gsbV4LastDispatched;
    ui.cards[0]!.onRetry!();
    ui.cards[0]!.onRetry!();
    expect(requests()).toHaveLength(2);
    expect(request().job).toEqual(expect.objectContaining({ query: original.job.query, mode: "manual", sourceTabId: 1 }));
    expect(request().job.id).not.toBe(original.job.id);
    expect(tab.gsbV4ActiveJob).toEqual(request().job);
    expect(tab.gsbV4LastDispatched).toBe(signature);
    expect(store.get(RECEIPTS_KEY)).toEqual(receipts);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ canRetry: false }));
  });

  it.each(["stale worker", "closed PiP", "missing worker", "busy worker", "old protocol", "pending request", "missing consent"])("does not retry or lose deduplication with %s", async (state) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    const original = await failSource(tab);
    const signature = tab.gsbV4LastDispatched;
    const receipts = structuredClone(store.get(RECEIPTS_KEY));
    const worker = store.get(WORKER_KEY) as Record<string, unknown>;
    if (state === "stale worker") vi.setSystemTime(initialTime + WORKER_MAX_AGE_MS + 1);
    else if (state === "closed PiP") store.set(WORKER_KEY, { ...worker, pipReady: false });
    else if (state === "missing worker") store.delete(WORKER_KEY);
    else if (state === "busy worker") store.set(WORKER_KEY, { ...worker, busy: true });
    else if (state === "old protocol") store.set(WORKER_KEY, { ...worker, protocolVersion: 3 });
    else if (state === "missing consent") store.delete(SETTINGS_KEY);
    else store.set(REQUEST_KEY, { ...original, job: { ...original.job, id: "other-source-job", sourceTabId: 2 } });
    const sharedRequest = structuredClone(store.get(REQUEST_KEY));
    ui.cards[0]!.onRetry!();
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4ActiveJob).toBeNull();
    expect(tab.gsbV4LastDispatched).toBe(signature);
    expect(store.get(RECEIPTS_KEY)).toEqual(receipts);
    expect(store.get(REQUEST_KEY)).toEqual(sharedRequest);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringMatching(/再送信してください/) }));
    store.delete(REQUEST_KEY);
    store.set(SETTINGS_KEY, { version: 4, consentAccepted: true });
    readyWorker(); vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4LastDispatched).toBe(signature);
  });

  it("keeps the next changed query automatic after an explicit retry", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await failSource(tab);
    ui.cards[0]!.onRetry!();
    const manual = request();
    changeQuery("latest");
    writeReceipt(manual.job, completed(manual.job));
    store.delete(REQUEST_KEY);
    notify(RECEIPTS_KEY);
    expect(requests()).toHaveLength(3);
    expect(request().job).toEqual(expect.objectContaining({ query: "latest", mode: "auto" }));
    expect(request().job.id).not.toBe(manual.job.id);
  });

  it("does not retry a consumed failure on focus, PiP heartbeat or document reload", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await failSource(tab);
    vi.stubGlobal("GM_getTabs", (callback: (tabs: Record<string, unknown>) => void) => callback({ owner: { gsbWorkerId: workerId } }));
    ui.cards[0]!.onOpen();
    await Promise.resolve();
    const focus = store.get(FOCUS_KEY) as Record<string, unknown>;
    expect(focus).toEqual(expect.objectContaining({ workerId, nonce: expect.any(String), createdAt: initialTime }));
    store.set(FOCUS_ACK_KEY, { ...focus, checkedAt: Date.now(), visible: true, hasFocus: true });
    notify(FOCUS_ACK_KEY);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ busy: false, canRetry: true }));
    store.set(WORKER_KEY, { ...store.get(WORKER_KEY) as object, pipReady: false });
    notify(WORKER_KEY);
    readyWorker(); vi.advanceTimersByTime(3_000);
    reloadDocument();
    await startGoogle(tab);
    readyWorker(); vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(1);
    expect(store.has(REQUEST_KEY)).toBe(false);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ canRetry: true }));
  });

  it.each(["PiP not ready", "stale worker"])("explains the pending search without sending when the worker is %s", async (state) => {
    if (state === "PiP not ready") store.set(WORKER_KEY, { ...store.get(WORKER_KEY) as object, pipReady: false });
    else vi.setSystemTime(initialTime + WORKER_MAX_AGE_MS + 1);
    await startGoogle({ gsbSourceTabId: 1 });
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({
      status: expect.stringMatching(state === "PiP not ready" ? /PiP小窓/ : /接続/),
    }));
    expect(requests()).toHaveLength(0);
  });

  it("keeps a completed answer when only Google URL telemetry changes", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    const terminal = await completeSource(tab);
    vi.stubGlobal("location", new URL(searchUrl("original") + "&sei=changed"));
    ui.changes[0]!();
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({
      answer: terminal.answer, conversationUrl: terminal.conversationUrl,
    }));
    expect(requests()).toHaveLength(1);
  });

  it("does not resurrect cached generating progress after recreating a closed worker", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = request();
    const generating: UserscriptReply = { jobId: original.job.id, sourceTabId: 1, status: "generating",
      updatedAt: Date.now(), progressText: "partial answer", conversationUrl: "https://gemini.google.com/app/0123456789abcdef" };
    writeReceipt(original.job, generating);
    store.delete(REQUEST_KEY);
    notify(RECEIPTS_KEY);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ progressText: "partial answer" }));
    vi.stubGlobal("GM_getTabs", (callback: (tabs: Record<string, unknown>) => void) => callback({}));
    const open = vi.fn(() => ({ closed: false, focus: vi.fn() }));
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout, open, addEventListener: vi.fn() });
    ui.cards[0]!.render.mockClear();
    ui.cards[0]!.onOpen();
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    expect(tab.gsbV4ActiveJob).toBeNull();
    vi.advanceTimersByTime(3_000);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.progressText && !state.answer && state.conversationUrl === null)).toBe(true);
    expect(requests()).toHaveLength(1);
    expect(store.has(REQUEST_KEY)).toBe(false);
  });

  it.each(["missing", "another source"])("restores a completed source after full document reload when shared reply is %s", async (sharedReply) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    const terminal = await completeSource(tab);
    const original = requests()[0]!;
    if (sharedReply === "another source") {
      store.set(REPLY_KEY, completed({ ...original.job, id: "another-source-job", sourceTabId: 2 }));
    }
    reloadDocument();
    await startGoogle(tab);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({
      answer: terminal.answer, conversationUrl: terminal.conversationUrl,
    }));
    readyWorker(); vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4LastJob).toEqual(original.job);
  });

  it("does not restore a completed answer for a different query after full document reload", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await completeSource(tab);
    reloadDocument("latest");
    await startGoogle(tab);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.answer && state.conversationUrl === null)).toBe(true);
    expect(requests()).toHaveLength(2);
    expect(request().job.query).toBe("latest");
  });

  it("does not restore or replay an expired completed answer after full document reload", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await completeSource(tab);
    reloadDocument();
    vi.setSystemTime(initialTime + MAX_JOB_AGE_MS);
    readyWorker();
    await startGoogle(tab);
    vi.advanceTimersByTime(3_000);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.answer && state.conversationUrl === null)).toBe(true);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringMatching(/再送信/) }));
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4ActiveJob).toBeNull();
  });

  it.each(["tab", "receipt"])("does not restore another source's answer when the %s source id differs", async (mismatch) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await completeSource(tab);
    const original = requests()[0]!;
    if (mismatch === "tab") tab.gsbSourceTabId = 2;
    else {
      const otherJob = { ...original.job, sourceTabId: 2 };
      writeReceipt(otherJob, completed(otherJob));
    }
    reloadDocument();
    await startGoogle(tab);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.answer && state.conversationUrl === null)).toBe(true);
    expect(requests()).toHaveLength(1);
  });

  it("explains a legacy consumed search without inferring an answer from an unrelated shared reply", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await completeSource(tab);
    const original = requests()[0]!;
    delete tab.gsbV4LastJob;
    store.set(REPLY_KEY, completed({ ...original.job, id: "another-source-job", sourceTabId: 2 }));
    reloadDocument();
    await startGoogle(tab);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.answer && state.conversationUrl === null)).toBe(true);
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringMatching(/復元できません/) }));
    expect(requests()).toHaveLength(1);
  });

  it.each(["https://example.com/search?q=original", searchUrl("different")])("rejects completed job metadata with an invalid source URL: %s", async (sourceUrl) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await completeSource(tab);
    tab.gsbV4LastJob = { ...requests()[0]!.job, sourceUrl };
    reloadDocument();
    await startGoogle(tab);
    expect(ui.cards[0]!.render.mock.calls.every(([state]) => !state.answer && state.conversationUrl === null)).toBe(true);
    expect(requests()).toHaveLength(1);
    expect(tab.gsbV4LastJob).toBeNull();
  });

  it("consumes an unacknowledged expired search without creating or replaying a fresh job", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = request();
    vi.setSystemTime(initialTime + MAX_JOB_AGE_MS);
    vi.advanceTimersByTime(3_000);
    expect(tab.gsbV4ActiveJob).toBeNull();
    readyWorker();
    changeQuery("original");
    vi.advanceTimersByTime(3_000);
    expect(requests().map((entry) => entry.job.id)).toEqual([original.job.id]);
    expect(store.has(REQUEST_KEY)).toBe(false);
  });

  it("retains a distinct latest query when the old unacknowledged search expires", async () => {
    await startGoogle({ gsbSourceTabId: 1 });
    const original = request();
    changeQuery("latest");
    vi.setSystemTime(initialTime + MAX_JOB_AGE_MS);
    vi.advanceTimersByTime(3_000);
    readyWorker();
    expect(requests()).toHaveLength(2);
    expect(request().job.query).toBe("latest");
    expect(request().job.id).not.toBe(original.job.id);
  });

  it.each(["original", "latest"])("restores an expired unacknowledged tab without replaying original: %s", async (query) => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = request();
    // Reload with the persisted tab state, no old instance's listeners or timers.
    vi.clearAllTimers(); listeners.clear(); ui.cards.length = 0; ui.changes.length = 0;
    writes.mockClear(); store.delete(REQUEST_KEY);
    vi.setSystemTime(initialTime + MAX_JOB_AGE_MS + 1);
    vi.stubGlobal("location", new URL(searchUrl(query)));
    readyWorker();
    await startGoogle(tab);
    expect(requests()).toHaveLength(query === "original" ? 0 : 1);
    if (query === "latest") {
      expect(request().job.query).toBe("latest");
      expect(request().job.id).not.toBe(original.job.id);
    } else expect(tab.gsbV4ActiveJob).toBeNull();
  });

  it("reoffers a losing source's same id and acknowledges a worker receipt before any reply", async () => {
    const firstTab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    const secondTab = { gsbSourceTabId: 2 } as Record<string, unknown>;
    await startGoogle(firstTab);
    const first = request();
    // Both sources can read an empty shared slot before either write is observed.
    staleSlotRead = true;
    await startGoogle(secondTab);
    staleSlotRead = false;
    const second = request();
    expect(second.job.sourceTabId).toBe(2);
    expect(second.job.id).not.toBe(first.job.id);
    writeReceipt(second.job);
    notify(RECEIPTS_KEY);
    expect(secondTab.gsbV4AcknowledgedJob).toBe(second.job.id);
    expect(store.has(REPLY_KEY)).toBe(false);
    store.delete(REQUEST_KEY); notify(REQUEST_KEY);
    expect(request().job.id).toBe(first.job.id);
    expect(requests().map((entry) => entry.job.id)).toEqual([first.job.id, second.job.id, first.job.id]);
    writeReceipt(first.job); notify(RECEIPTS_KEY);
    expect(firstTab.gsbV4AcknowledgedJob).toBe(first.job.id);
    store.delete(REQUEST_KEY); notify(REQUEST_KEY);
    readyWorker(); vi.advanceTimersByTime(3_000);
    expect(requests()).toHaveLength(3);
  });

  it("recovers a missed terminal reply from its durable receipt after another source overwrites reply", async () => {
    const tab = { gsbSourceTabId: 1 } as Record<string, unknown>;
    await startGoogle(tab);
    const original = request();
    const terminal = completed(original.job);
    writeReceipt(original.job, terminal);
    const other = completed({ ...original.job, id: "another-source-job", sourceTabId: 2 });
    store.set(REPLY_KEY, other); store.delete(REQUEST_KEY);
    // Deliberately omit storage notifications: the periodic recovery must find it.
    vi.advanceTimersByTime(3_000);
    expect(tab.gsbV4ActiveJob).toBeNull();
    expect(ui.cards[0]!.render).toHaveBeenLastCalledWith(expect.objectContaining({ answer: terminal.answer }));
    expect(store.get(REPLY_KEY)).toEqual(other);
    readyWorker();
    expect(requests()).toHaveLength(1);
  });
});
