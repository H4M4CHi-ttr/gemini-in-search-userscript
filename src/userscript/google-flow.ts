import { SearchCardView } from "../content/google/card-view";
import { SearchOverrides } from "../content/google/search-overrides";
import { observeGoogleQuery, readGoogleQuery } from "../content/google/query-observer";
import { createQueryJob, isPositiveTabId, isQueryJob, type QueryJob } from "../shared/query-models";
import { consentAccepted, documentReady } from "./settings";
import { SearchQueue, searchSignature } from "./search-queue";
import { readReceipt } from "./receipts";
import {
  REQUEST_KEY, REPLY_KEY, WORKER_KEY, SETTINGS_KEY, RECEIPTS_KEY, MAX_JOB_AGE_MS, FOCUS_KEY, FOCUS_ACK_KEY,
  isUserscriptReply, isUserscriptRequest, pendingRequest, liveWorker, storedWorker, isFocusAck,
  type UserscriptReply, type UserscriptRequest, type UserscriptFocusRequest,
} from "./protocol";

const GEMINI_APP = "https://gemini.google.com/app";
const TERMINAL = new Set(["completed", "manual_intervention", "not_logged_in", "rate_limited", "frame_blocked", "selector_not_found", "timed_out", "cancelled", "failed"]);

export async function startGoogle(tab: Record<string, unknown>): Promise<void> {
  await documentReady();
  if (document.getElementById("gemini-search-bridge-root")) return;
  const sourceTabId = isPositiveTabId(tab.gsbSourceTabId) ? tab.gsbSourceTabId : crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
  tab.gsbSourceTabId = sourceTabId;
  function savedJob(value: unknown): QueryJob | null {
    return isQueryJob(value) && value.sourceTabId === sourceTabId &&
      readGoogleQuery(value.sourceUrl) === value.query ? value : null;
  }
  const storedJob = savedJob(tab.gsbV4ActiveJob);
  let job: QueryJob | null = storedJob && Date.now() >= storedJob.createdAt &&
    Date.now() - storedJob.createdAt < MAX_JOB_AGE_MS ? storedJob : null;
  const queue = new SearchQueue(typeof tab.gsbV4LastDispatched === "string" ? tab.gsbV4LastDispatched : null);
  if (storedJob && !job) queue.lastDispatched = searchSignature(storedJob);
  const storedLastJob = savedJob(tab.gsbV4LastJob) ?? storedJob;
  let lastJob = storedLastJob && Date.now() >= storedLastJob.createdAt &&
    Date.now() - storedLastJob.createdAt < MAX_JOB_AGE_MS ? storedLastJob : null;
  let reply: UserscriptReply | null = null;
  let acknowledged = job !== null && tab.gsbV4AcknowledgedJob === job.id;
  let detail: string | undefined;
  let opening = false;
  let opened = false;
  let popup: Window | null = null;
  let pendingFocus: UserscriptFocusRequest | null = null;
  let focusTimer: number | undefined;
  const card = new SearchCardView(() => { void openWorker(); }, retryCurrent);
  card.mount();
  const overrides = new SearchOverrides();
  let displayedSignature = currentSignature();

  function currentSignature(): string | null {
    const query = readGoogleQuery();
    return query ? searchSignature({ query, sourceUrl: location.href }) : null;
  }
  function restoreDisplayedReply(): void {
    if (job || reply || !lastJob || searchSignature(lastJob) !== currentSignature()) return;
    const value = readReceipt(lastJob)?.reply;
    if (value && TERMINAL.has(value.status)) { reply = value; detail = undefined; }
  }

  function save(): void {
    tab.gsbV4ActiveJob = job;
    tab.gsbV4LastDispatched = queue.lastDispatched;
    tab.gsbV4AcknowledgedJob = acknowledged && job ? job.id : null;
    tab.gsbV4LastJob = lastJob;
    GM_saveTab(tab);
  }
  function render(): void {
    const existing = storedWorker(GM_getValue(WORKER_KEY, null));
    const worker = liveWorker(GM_getValue(WORKER_KEY, null));
    const status = reply?.status === "completed" ? undefined : reply?.status === "generating" ? "生成中…" :
      reply && TERMINAL.has(reply.status) ? "Geminiの確認が必要です" : job ? "Geminiに送信しています…" :
        queue.pending && existing && !worker ? "Geminiとの接続を待っています…" :
          (opened || queue.pending && existing) && !worker?.pipReady ? "Gemini側でPiP小窓を開いてください" :
            queue.pending && consentAccepted() && worker?.pipReady && worker.busy ? "前の回答の完了を待っています…" : undefined;
    const consumedWithoutResult = !job && !reply && queue.lastDispatched === currentSignature();
    const recoveryDetail = consumedWithoutResult
      ? "前の結果を復元できません。検索語は再送信していません。Geminiで送信状況を確認してから、必要なら「この検索を再送信」を押してください。"
      : queue.pending && existing && !worker
        ? "接続を確認できていません。「Geminiウィンドウを開く」で本体を表示してください。検索語は再送信しません。" : undefined;
    const message = detail ?? reply?.detail ?? recoveryDetail;
    card.render({
      jobId: job?.id ?? reply?.jobId ?? reply?.answer?.jobId,
      ...(status ? { status } : {}), ...(message ? { detail: message } : {}),
      ...(reply?.progressText ? { progressText: reply.progressText } : {}),
      ...(reply?.answer ? { answer: reply.answer } : {}), conversationUrl: reply?.conversationUrl ?? null,
      busy: opening,
      pipReady: consentAccepted() && worker?.protocolVersion === 4 && worker.pipReady === true,
      canRetry: !job && !opening && (consumedWithoutResult || !!reply && reply.status !== "completed" && TERMINAL.has(reply.status)),
    });
    overrides.setConversationUrl(reply?.conversationUrl ?? null);
  }
  function offerCurrent(): void {
    const query = readGoogleQuery();
    queue.offer(query ? { query, sourceUrl: location.href } : null);
  }
  function dispatchLatest(): void {
    const worker = liveWorker(GM_getValue(WORKER_KEY, null));
    const shared = pendingRequest(GM_getValue(REQUEST_KEY, null));
    if (job && !acknowledged) {
      if (readReceipt(job)) acknowledge();
      else if (!shared && worker?.pipReady && !worker.busy && consentAccepted()) {
        // Re-offer the SAME id. A durable worker receipt prevents duplicates after missed events.
        GM_setValue(REQUEST_KEY, { workerId: worker.id, job, version: 4 } satisfies UserscriptRequest);
      }
    }
    if (job || !queue.pending || !consentAccepted() || !worker?.pipReady || worker.protocolVersion !== 4 || worker.busy ||
        pendingRequest(GM_getValue(REQUEST_KEY, null))) { render(); return; }
    startPending(worker.id, "auto");
  }
  function startPending(workerId: string, mode: "auto" | "manual"): void {
    const next = queue.pending;
    if (!next || job) return;
    try {
      job = createQueryJob({ sourceTabId, query: next.query, sourceUrl: next.sourceUrl, mode, promptMode: "raw" });
      // Keep the pending slot until the sole worker acknowledges this job.
      acknowledged = false; reply = null; detail = undefined; save();
      GM_setValue(REQUEST_KEY, { workerId, job, version: 4 } satisfies UserscriptRequest);
    } catch (error) {
      detail = error instanceof Error ? error.message : "Geminiへの送信を開始できませんでした。";
      // A storage failure can have an uncertain delivery outcome; never make a fresh id for it.
      acknowledge();
      job = null; save();
    }
    render();
  }
  function retryCurrent(): void {
    const query = readGoogleQuery();
    const worker = liveWorker(GM_getValue(WORKER_KEY, null));
    if (!query || job) return;
    if (!consentAccepted() || !worker?.pipReady || worker.protocolVersion !== 4 || worker.busy ||
        pendingRequest(GM_getValue(REQUEST_KEY, null))) {
      detail = "Geminiの必要な操作を済ませ、PiPを表示し、実行中の回答が終わってから再送信してください。";
      render(); return;
    }
    // Only this explicit click offers a consumed query again. Keep its old receipt/signature.
    queue.pending = { query, sourceUrl: location.href };
    startPending(worker.id, "manual");
  }
  function acknowledge(): void {
    if (!job || acknowledged) return;
    acknowledged = true;
    lastJob = job;
    const signature = searchSignature(job);
    if (queue.pending && searchSignature(queue.pending) === signature) queue.dispatched();
    else queue.lastDispatched = signature;
    save();
  }
  function receiveReply(value: unknown): void {
    if (!job || !isUserscriptReply(value) || value.jobId !== job.id || value.sourceTabId !== sourceTabId ||
        value.updatedAt < job.createdAt) return;
    acknowledge();
    if (job.query === readGoogleQuery()) { reply = value; detail = undefined; }
    if (TERMINAL.has(value.status)) { job = null; save(); }
    render();
    dispatchLatest();
  }
  function createWorker(): void {
    const id = crypto.randomUUID();
    popup = window.open(`${GEMINI_APP}#gsb-worker=${id}`, "GeminiSearchBridgeWorker", "popup,width=480,height=720");
    if (!popup) throw new Error("ポップアップがブロックされました。このGoogle検索サイトのポップアップを許可し、もう一度押してください。");
    opened = true;
    detail = undefined;
  }
  async function openWorker(): Promise<void> {
    if (opening) return;
    opening = true;
    try {
      const worker = storedWorker(GM_getValue(WORKER_KEY, null));
      if (!worker) {
        // No await before creating a popup: preserve the user's activation.
        if (popup && !popup.closed) popup.focus(); else createWorker();
        opened = true;
      } else {
        const tabs = await new Promise<Record<string, Record<string, unknown>>>((resolve) => GM_getTabs(resolve));
        if (storedWorker(GM_getValue(WORKER_KEY, null))?.id !== worker.id) throw new Error("ウィンドウの状態が変わりました。もう一度押してください。");
        if (!Object.values(tabs).some((entry) => entry?.gsbWorkerId === worker.id)) {
          const request = GM_getValue<unknown>(REQUEST_KEY, null);
          if (isUserscriptRequest(request) && request.workerId === worker.id) {
            GM_setValue(REPLY_KEY, { jobId: request.job.id, sourceTabId: request.job.sourceTabId, status: "manual_intervention",
              updatedAt: Date.now(), detail: "Geminiウィンドウが閉じられました。前の検索語は再送信しません。" } satisfies UserscriptReply);
            GM_deleteValue(REQUEST_KEY);
          }
          GM_deleteValue(WORKER_KEY);
          acknowledge();
          job = null; reply = null; save();
          // Creating after an asynchronous tab inventory can be blocked. Explain, never duplicate silently.
          createWorker();
          detail = "新しいウィンドウを開きました。前の検索語は再送信しません。";
        } else {
          opened = true;
          pendingFocus = { workerId: worker.id, nonce: crypto.randomUUID(), createdAt: Date.now() };
          detail = "既存のGeminiウィンドウを表示しています…";
          GM_setValue(FOCUS_KEY, pendingFocus);
          focusTimer = window.setTimeout(() => {
            pendingFocus = null; opening = false;
            detail = "表示を確認できませんでした。Tampermonkey 5.5以降とwindow.focusの許可を確認し、タスクバーから復元してください。";
            render();
          }, 8_000);
        }
      }
    } catch (error) { detail = error instanceof Error ? error.message : "Geminiを開けませんでした。"; }
    finally { if (!pendingFocus) opening = false; render(); }
  }
  GM_addValueChangeListener(FOCUS_ACK_KEY, (_key, _old, value) => {
    if (!pendingFocus || !isFocusAck(value) || value.nonce !== pendingFocus.nonce || value.workerId !== pendingFocus.workerId) return;
    pendingFocus = null; window.clearTimeout(focusTimer); opening = false;
    detail = value.visible && value.hasFocus ? undefined : "復元を確認できません。タスクバーからGeminiを表示してください。";
    render();
  });
  GM_addValueChangeListener(REPLY_KEY, (_key, _old, value) => receiveReply(value));
  GM_addValueChangeListener(WORKER_KEY, dispatchLatest);
  GM_addValueChangeListener(REQUEST_KEY, dispatchLatest);
  GM_addValueChangeListener(SETTINGS_KEY, dispatchLatest);
  GM_addValueChangeListener(RECEIPTS_KEY, () => {
    if (job) { const entry = readReceipt(job); if (entry?.reply) receiveReply(entry.reply); }
    restoreDisplayedReply();
    dispatchLatest();
  });
  observeGoogleQuery(() => {
    const signature = currentSignature();
    // Google's URL telemetry changes are not a new search and must not erase its answer.
    if (signature === displayedSignature) return;
    displayedSignature = signature;
    reply = null; detail = undefined;
    restoreDisplayedReply();
    offerCurrent(); render(); dispatchLatest();
  });
  offerCurrent(); save(); restoreDisplayedReply(); render();
  receiveReply(GM_getValue(REPLY_KEY, null));
  dispatchLatest();
  window.setInterval(() => {
    if (job) { const entry = readReceipt(job); if (entry?.reply) receiveReply(entry.reply); }
    restoreDisplayedReply();
    receiveReply(GM_getValue(REPLY_KEY, null));
    if (job && Date.now() - job.createdAt >= MAX_JOB_AGE_MS) {
      // Consume the interrupted search too: recovery must not replay it under a new id.
      acknowledge();
      const pending = GM_getValue<unknown>(REQUEST_KEY, null);
      if (isUserscriptRequest(pending) && pending.job.id === job.id) GM_deleteValue(REQUEST_KEY);
      job = null; save();
      detail = "Geminiとの接続を確認してください。前の検索語は自動再送信しません。";
    }
    dispatchLatest();
  }, 3_000);
}
