import { Phase2GeminiAdapter, GeminiAdapterError } from "../content/gemini/gemini-adapter";
import { captureAnswerBaseline, observeAnswerCompletion, AnswerObserverError } from "../content/gemini/gemini-answer-observer";
import { extractStructuredAnswer } from "../content/gemini/gemini-extractor";
import { MAX_ANSWER_TEXT_LENGTH } from "../shared/answer-models";
import { buildPrompt } from "../shared/prompt-builder";
import { sanitizeConversationUrl } from "../shared/conversation-url";
import { PipCompanion } from "./pip";
import { WorkerView } from "./worker-view";
import { acceptConsent, consentAccepted, documentReady } from "./settings";
import { readReceipt, writeReceipt, pruneReceipts } from "./receipts";
import { submittedQueryMatches } from "./conversation-guard";
import {
  REQUEST_KEY, REPLY_KEY, WORKER_KEY, FOCUS_KEY, FOCUS_ACK_KEY, MAX_JOB_AGE_MS,
  liveWorker, storedWorker, pendingRequest, isUserscriptRequest, isUserscriptReply, isFocusRequest,
  type UserscriptRequest, type UserscriptReply,
} from "./protocol";
import type { JobStatus } from "../shared/query-models";

export async function startGemini(tab: Record<string, unknown>, workerId: string): Promise<void> {
  const existing = liveWorker(GM_getValue(WORKER_KEY, null));
  if (existing && existing.id !== workerId) return;
  tab.gsbWorkerId = workerId;
  GM_saveTab(tab);
  await documentReady();
  const adapter = new Phase2GeminiAdapter();
  let controller: AbortController | null = null;
  let active: UserscriptRequest | null = null;
  let progressText = "";
  let status = "PiPを開くと、この検索と次の検索を自動送信します。";
  let routeChanged = false;
  let routeTimer: number | undefined;
  let newChatReady = false;
  let lastFocusNonce = tab.gsbFocusNonce;
  const pip = new PipCompanion(window, surfaceChanged);
  const view = new WorkerView({
    onOpenPip() {
      // open() invokes the native API now, in the trusted button click stack.
      void pip.open().then(() => {
        acceptConsent();
        status = "検索画面に戻って、そのまま検索を続けられます。";
        surfaceChanged();
      }).catch(() => {
        status = "PiPを開けませんでした。Chromeでこのボタンを直接押してください。";
        updateView();
      });
    },
    onClosePip() { pip.close(); },
    onInspect() { if (active) { routeChanged = true; controller?.abort(); } },
  });

  function updateView(): void {
    view.update({ pipReady: pip.visible(), supported: pip.available, status });
  }
  function heartbeat(): void {
    const owner = liveWorker(GM_getValue(WORKER_KEY, null));
    if (owner && owner.id !== workerId) { controller?.abort(); return; }
    GM_setValue(WORKER_KEY, { id: workerId, seenAt: Date.now(), visible: document.visibilityState === "visible",
      busy: controller !== null, pipReady: pip.visible() && consentAccepted(), protocolVersion: 4,
      ...(active ? { activeJobId: active.job.id } : {}) });
    const reply = GM_getValue<unknown>(REPLY_KEY, null);
    if (isUserscriptReply(reply) && Date.now() - reply.updatedAt > MAX_JOB_AGE_MS) GM_deleteValue(REPLY_KEY);
    pruneReceipts();
    const request = GM_getValue<unknown>(REQUEST_KEY, null);
    if (isUserscriptRequest(request) && !pendingRequest(request) && !active) GM_deleteValue(REQUEST_KEY);
  }
  function visibilityDetail(): string | undefined {
    return pip.visible() ? undefined : "PiPが閉じているため取得を待機中です。Gemini側で小窓を開くと再開します。再送信はしません。";
  }
  function publish(request: UserscriptRequest, phase: JobStatus, detail?: string, answer?: UserscriptReply["answer"]): void {
    if (phase === "generating" && Date.now() >= request.job.createdAt + MAX_JOB_AGE_MS) return;
    const currentUrl = readConversationUrl();
    const conversationUrl = (phase === "generating" || phase === "completed") && currentUrl === tab.gsbRunConversationUrl ? currentUrl : null;
    const reply: UserscriptReply = {
      jobId: request.job.id, sourceTabId: request.job.sourceTabId, status: phase, updatedAt: Date.now(),
      ...(detail ? { detail: detail.slice(0, 500) } : {}), ...(answer ? { answer } : {}),
      ...(phase === "generating" ? { progressText: progressText.slice(0, MAX_ANSWER_TEXT_LENGTH) } : {}),
      ...(conversationUrl ? { conversationUrl } : {}),
    };
    writeReceipt(request.job, reply);
    GM_setValue(REPLY_KEY, reply);
  }
  function readConversationUrl(): string | null {
    const url = new URL(location.href);
    // Native route only; worker marker/Google telemetry are never link targets.
    return sanitizeConversationUrl(`${url.origin}${url.pathname}`);
  }
  async function pinConversation(signal: AbortSignal, query: string): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (!signal.aborted && Date.now() < deadline) {
      const url = readConversationUrl();
      if (url && url !== tab.gsbPreviousConversationUrl && submittedQueryMatches(document, query)) {
        tab.gsbRunConversationUrl = url; GM_saveTab(tab); return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new GeminiAdapterError("manual_intervention", "この検索の会話URLを確認できません。Geminiで既存のチャットを確認してください。自動再送信はしません。");
  }
  function surfaceChanged(): void {
    if (active && tab.gsbRunPhase === "generating") publish(active, "generating", visibilityDetail());
    // Once submission begins its outcome may be uncertain: never abort into an auto resend.
    else if (controller && tab.gsbRunPhase !== "submitting" && !pip.visible()) controller.abort();
    heartbeat();
    updateView();
    if (pip.visible()) void processRequest();
  }
  async function processRequest(): Promise<void> {
    const request = pendingRequest(GM_getValue(REQUEST_KEY, null));
    if (controller || !request || request.workerId !== workerId || !consentAccepted() || !pip.visible() ||
        liveWorker(GM_getValue(WORKER_KEY, null))?.id !== workerId) return;
    const receipt = readReceipt(request.job);
    const resume = tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating";
    if (receipt && !resume) {
      if (receipt.reply && receipt.reply.status !== "generating" && receipt.reply.status !== "loading_gemini" &&
          receipt.reply.status !== "starting_new_chat" && receipt.reply.status !== "filling_prompt" && receipt.reply.status !== "submitting") {
        GM_setValue(REPLY_KEY, receipt.reply);
      } else publish(request, "manual_intervention", "受理済みの検索です。Geminiで送信状況を確認してください。自動再送信はしません。");
      GM_deleteValue(REQUEST_KEY); return;
    }
    controller = new AbortController();
    active = request;
    routeChanged = false;
    newChatReady = false;
    const signal = controller.signal;
    writeReceipt(request.job);
    const previous = GM_getValue<unknown>(REPLY_KEY, null);
    progressText = isUserscriptReply(previous) && previous.jobId === request.job.id ? previous.progressText ?? "" : "";
    heartbeat();
    routeTimer = window.setInterval(() => {
      if (tab.gsbRunConversationUrl) {
        if (readConversationUrl() !== tab.gsbRunConversationUrl) { routeChanged = true; controller?.abort(); }
      } else if (newChatReady && tab.gsbRunPhase === "preparing" && !/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname)) {
        routeChanged = true; controller?.abort();
      }
    }, 100);
    try {
      if (tab.gsbRunId === request.job.id && tab.gsbRunPhase === "submitting") {
        throw new GeminiAdapterError("manual_intervention", "送信中にページが切り替わりました。Geminiで送信状況を確認してください。自動再送信はしません。");
      }
      let baseline = { nodes: [] as readonly Element[], lastText: "" };
      let submittedAt = typeof tab.gsbSubmittedAt === "number" ? tab.gsbSubmittedAt : Date.now();
      if (!(tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating")) {
        tab.gsbPreviousConversationUrl = readConversationUrl();
        tab.gsbRunConversationUrl = null;
        tab.gsbRunId = request.job.id;
        tab.gsbRunPhase = "preparing";
        GM_saveTab(tab);
        publish(request, "loading_gemini");
        await adapter.waitUntilReady(signal);
        if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail()!);
        publish(request, "starting_new_chat");
        // SPA only: hard navigation would close the owner-bound native PiP.
        await adapter.startNewChat(signal);
        newChatReady = true;
        if (!/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname)) throw new GeminiAdapterError("manual_intervention", "新規チャットの準備を確認できませんでした。");
        if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail()!);
        publish(request, "filling_prompt");
        await adapter.fillPrompt(buildPrompt(request.job.query, "raw"), signal);
        if (!/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname) || routeChanged) throw new GeminiAdapterError("manual_intervention", "準備中に会話が変わりました。送信を停止しました。");
        if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail()!);
        baseline = captureAnswerBaseline(document);
        tab.gsbRunPhase = "submitting";
        GM_saveTab(tab);
        publish(request, "submitting");
        await adapter.submit(signal);
        submittedAt = Date.now();
        tab.gsbSubmittedAt = submittedAt;
        tab.gsbRunPhase = "generating";
        GM_saveTab(tab);
        await pinConversation(signal, request.job.query);
      }
      if (!tab.gsbRunConversationUrl || readConversationUrl() !== tab.gsbRunConversationUrl ||
          !submittedQueryMatches(document, request.job.query) || routeChanged) {
        throw new GeminiAdapterError("manual_intervention", "生成中の会話が変わりました。取り違えを防ぐため取得を停止しました。自動再送信はしません。");
      }
      publish(request, "generating");
      status = "生成中です。PiP小窓を表示したまま検索に戻れます。";
      updateView();
      let lastProgressAt = 0;
      const root = await observeAnswerCompletion(document, baseline, submittedAt, signal, undefined, {
        pauseWhenHidden: true, deadlineAt: request.job.createdAt + MAX_JOB_AGE_MS,
        isSurfaceVisible: () => pip.visible(),
        onText(snapshot) {
          if (readConversationUrl() !== tab.gsbRunConversationUrl) { routeChanged = true; controller?.abort(); return; }
          progressText = snapshot.slice(0, MAX_ANSWER_TEXT_LENGTH);
          pip.update("生成中…", progressText);
          if (Date.now() - lastProgressAt < 250) return;
          lastProgressAt = Date.now();
          publish(request, "generating", visibilityDetail());
        },
      });
      if (readConversationUrl() !== tab.gsbRunConversationUrl) throw new GeminiAdapterError("manual_intervention", "会話が変わったため回答取得を停止しました。");
      const answer = extractStructuredAnswer(root, { jobId: request.job.id, sourceTabId: request.job.sourceTabId, completedAt: Date.now() });
      publish(request, "completed", undefined, answer);
      pip.update("回答が完了しました", answer.plainText);
      status = "回答を検索画面に表示しました。次の検索も自動送信します。";
    } catch (error) {
      const code = tab.gsbRunPhase === "submitting" || routeChanged ? "manual_intervention" :
        error instanceof GeminiAdapterError || error instanceof AnswerObserverError ? error.code : "failed";
      publish(request, !pip.visible() && code === "failed" ? "manual_intervention" : code,
        routeChanged ? "生成中の会話が変わりました。取り違えを防ぐため取得を停止しました。自動再送信はしません。" :
        tab.gsbRunPhase === "submitting" ? "送信を確認できません。既存のチャットを確認してください。自動再送信はしません。" :
          visibilityDetail() ?? (error instanceof Error ? error.message : "Geminiの操作に失敗しました。"));
      status = "Geminiで必要な操作を確認してください。自動再送信はしません。";
      pip.update(status, progressText);
      view.revealGemini();
    } finally {
      window.clearInterval(routeTimer);
      tab.gsbRunPhase = "settled";
      GM_saveTab(tab);
      const current = GM_getValue<unknown>(REQUEST_KEY, null);
      if (isUserscriptRequest(current) && current.job.id === request.job.id) GM_deleteValue(REQUEST_KEY);
      controller = null;
      active = null;
      heartbeat(); updateView();
    }
  }
  function focusRequested(value: unknown): void {
    if (!isFocusRequest(value) || value.workerId !== workerId || value.nonce === lastFocusNonce ||
        storedWorker(GM_getValue(WORKER_KEY, null))?.id !== workerId) return;
    lastFocusNonce = value.nonce;
    tab.gsbFocusNonce = value.nonce;
    GM_saveTab(tab);
    try { window.focus(); } catch { /* Checked acknowledgement reports the browser decision. */ }
    window.setTimeout(() => {
      if (!isFocusRequest(value)) return;
      heartbeat();
      GM_setValue(FOCUS_ACK_KEY, { ...value, checkedAt: Date.now(), visible: document.visibilityState === "visible", hasFocus: document.hasFocus() });
    }, 500);
  }
  document.addEventListener("visibilitychange", surfaceChanged);
  window.addEventListener("popstate", () => { if (active) { routeChanged = true; controller?.abort(); } });
  GM_addValueChangeListener(REQUEST_KEY, () => { if (!active) void processRequest(); });
  GM_addValueChangeListener(FOCUS_KEY, (_key, _old, value) => focusRequested(value));
  heartbeat(); updateView();
  focusRequested(GM_getValue(FOCUS_KEY, null));
  window.setInterval(() => { heartbeat(); void processRequest(); }, 3_000);
}
