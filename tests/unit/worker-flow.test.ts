import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGemini } from "../../src/userscript/worker";
import { LEGACY_REQUEST_KEY, REQUEST_KEY, REPLY_KEY, WORKER_KEY, SETTINGS_KEY, type UserscriptRequest } from "../../src/userscript/protocol";
import { writeReceipt } from "../../src/userscript/receipts";

const native = vi.hoisted(() => ({
  prompt: "", visibleTurn: "", useWrongTurn: false,
  ready: vi.fn(), newChat: vi.fn(), fill: vi.fn(), submit: vi.fn(), observe: vi.fn(), extract: vi.fn(),
}));
vi.mock("../../src/content/gemini/gemini-adapter", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/content/gemini/gemini-adapter")>(),
  Phase2GeminiAdapter: class {
    waitUntilReady = native.ready;
    startNewChat = native.newChat;
    fillPrompt = native.fill;
    submit = native.submit;
  },
}));
vi.mock("../../src/content/gemini/gemini-answer-observer", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/content/gemini/gemini-answer-observer")>(),
  captureAnswerBaseline: () => ({ nodes: [], lastText: "" }),
  observeAnswerCompletion: native.observe,
}));
vi.mock("../../src/content/gemini/gemini-extractor", () => ({ extractStructuredAnswer: native.extract }));
vi.mock("../../src/userscript/pip", () => ({ PipCompanion: class {
  available = true;
  visible() { return true; }
  open() { return Promise.resolve(); }
  close() {}
  update() {}
  refreshLanguage() {}
} }));
vi.mock("../../src/userscript/worker-view", () => ({ WorkerView: class {
  update() {}
  revealGemini() {}
} }));

const now = 1_800_000_000_000;
const workerId = "00000000-0000-4000-8000-000000000001";
const conversation = "https://gemini.google.com/app/0123456789abcdef";
const request = (): UserscriptRequest => ({ workerId, version: 5, job: {
  id: "formatted-job", sourceTabId: 1, query: "2+2", sourceUrl: "https://www.google.com/search?q=2%2B2",
  createdAt: now, mode: "auto", conversationMode: "new_chat", promptMode: "raw",
  promptText: "Search the web and cite your sources: 2+2",
} });
let store: Map<string, unknown>;
let listeners: Map<string, (key: string, old: unknown, value: unknown, remote: boolean) => void>;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.clearAllMocks(); native.prompt = ""; native.visibleTurn = ""; native.useWrongTurn = false;
  store = new Map<string, unknown>([[SETTINGS_KEY, { version: 4, consentAccepted: true }], [REQUEST_KEY, request()]]);
  listeners = new Map();
  vi.stubGlobal("GM_getValue", (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal("GM_setValue", (key: string, value: unknown) => store.set(key, structuredClone(value)));
  vi.stubGlobal("GM_deleteValue", (key: string) => store.delete(key));
  vi.stubGlobal("GM_saveTab", vi.fn());
  vi.stubGlobal("GM_addValueChangeListener", (key: string, listener: (key: string, old: unknown, value: unknown, remote: boolean) => void) => {
    listeners.set(key, listener); return listeners.size;
  });
  vi.stubGlobal("document", {
    readyState: "complete", visibilityState: "hidden", addEventListener: vi.fn(), hasFocus: () => false,
    querySelectorAll: (selector: string) => selector === "user-query" && native.visibleTurn ? [{
      textContent: native.visibleTurn, querySelectorAll: () => [], querySelector: () => null,
    }] : [],
  });
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: vi.fn(), focus: vi.fn() });
  vi.stubGlobal("location", new URL("https://gemini.google.com/app"));
  native.ready.mockResolvedValue(undefined);
  native.newChat.mockImplementation(async () => { vi.stubGlobal("location", new URL("https://gemini.google.com/app")); });
  native.fill.mockImplementation(async (prompt: string) => { native.prompt = prompt; });
  native.submit.mockImplementation(async () => {
    native.visibleTurn = native.useWrongTurn ? "2+2" : native.prompt;
    vi.stubGlobal("location", new URL(conversation));
  });
  native.observe.mockResolvedValue({ textContent: "4" });
  native.extract.mockImplementation((_root, metadata) => ({ ...metadata, plainText: "4", blocks: [{ type: "paragraph", text: "4" }], links: [] }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("formatted userscript worker pipeline", () => {
  it("fills and pins the formatted snapshot instead of the raw search query", async () => {
    await startGemini({}, workerId);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.fill).toHaveBeenCalledWith(request().job.promptText, expect.any(AbortSignal));
    expect(native.submit).toHaveBeenCalledTimes(1);
    expect(native.observe).toHaveBeenCalledTimes(1);
    expect(store.get(WORKER_KEY)).toEqual(expect.objectContaining({ protocolVersion: 5, busy: false }));
    expect(store.get(REPLY_KEY)).toEqual(expect.objectContaining({ status: "completed", conversationUrl: conversation }));
  });

  it("does not pin a native raw turn to a job whose submitted text was formatted", async () => {
    native.useWrongTurn = true;
    await startGemini({}, workerId);
    await vi.advanceTimersByTimeAsync(11_100);
    expect(native.submit).toHaveBeenCalledTimes(1);
    expect(native.observe).not.toHaveBeenCalled();
    expect(store.get(REPLY_KEY)).toEqual(expect.objectContaining({ status: "manual_intervention" }));
  });

  it.each(["formatted", "raw"])("resumes after worker reload only when the fresh native turn matches the frozen prompt: %s", async (turn) => {
    const item = request();
    const tab = { gsbRunId: item.job.id, gsbRunPhase: "generating", gsbRunConversationUrl: conversation, gsbSubmittedAt: now };
    native.visibleTurn = turn === "formatted" ? item.job.promptText : item.job.query;
    vi.stubGlobal("location", new URL(conversation));
    writeReceipt(item.job, { jobId: item.job.id, sourceTabId: 1, status: "generating", updatedAt: now });
    await startGemini(tab, workerId);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.fill).not.toHaveBeenCalled();
    expect(native.submit).not.toHaveBeenCalled();
    if (turn === "formatted") {
      expect(native.observe).toHaveBeenCalledTimes(1);
      expect(store.get(REPLY_KEY)).toEqual(expect.objectContaining({ status: "completed" }));
    } else {
      expect(native.observe).not.toHaveBeenCalled();
      expect(store.get(REPLY_KEY)).toEqual(expect.objectContaining({ status: "manual_intervention" }));
    }
  });

  it("ignores legacy v4 requests, even while the preserved legacy key exists", async () => {
    const legacy = { ...request(), version: 4 };
    store.set(REQUEST_KEY, legacy); store.set(LEGACY_REQUEST_KEY, legacy);
    await startGemini({}, workerId);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.fill).not.toHaveBeenCalled();
    expect(native.submit).not.toHaveBeenCalled();
    expect(store.get(LEGACY_REQUEST_KEY)).toEqual(legacy);
  });
});
