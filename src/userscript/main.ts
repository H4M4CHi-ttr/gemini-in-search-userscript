import { Phase2GeminiAdapter, GeminiAdapterError } from "../content/gemini/gemini-adapter";
import { captureAnswerBaseline, observeAnswerCompletion, AnswerObserverError } from "../content/gemini/gemini-answer-observer";
import { extractStructuredAnswer } from "../content/gemini/gemini-extractor";
import { findFirstSelector, GEMINI_SELECTORS } from "../content/gemini/gemini-selectors";
import { SearchCardView, resolveCardLanguage, USERSCRIPT_USAGE_NOTICE, type CardLanguage } from "../content/google/card-view";
import { observeGoogleQuery, readGoogleQuery } from "../content/google/query-observer";
import { createQueryJob, isPositiveTabId, isQueryJob, type QueryJob, type JobStatus } from "../shared/query-models";
import { buildPrompt } from "../shared/prompt-builder";
import { MAX_ANSWER_TEXT_LENGTH } from "../shared/answer-models";
import { PipCompanion } from "./pip";
import {
  REQUEST_KEY, REPLY_KEY, WORKER_KEY, SETTINGS_KEY, MAX_JOB_AGE_MS, FOCUS_KEY, FOCUS_ACK_KEY,
  isWorkerId, isUserscriptReply, isUserscriptRequest, pendingRequest, liveWorker, storedWorker, isFocusRequest, isFocusAck,
  type UserscriptReply, type UserscriptRequest, type UserscriptFocusRequest,
} from "./protocol";

const GEMINI_APP = "https://gemini.google.com/app";
const WORKER_TARGET = "GeminiSearchBridgeWorker";
const initialWorkerId = /^#gsb-worker=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];

interface Preferences {
  consentAccepted: boolean;
  autoRun: boolean;
  language: "auto" | CardLanguage;
  usePip: boolean;
}

function preferences(): Preferences {
  const value = GM_getValue<unknown>(SETTINGS_KEY, null);
  const stored = typeof value === "object" && value !== null
    ? value as Record<string, unknown> : {};
  return {
    consentAccepted: stored.consentAccepted === true,
    autoRun: stored.autoRun === true,
    language: stored.language === "ja" || stored.language === "en" ? stored.language : "auto",
    usePip: stored.usePip === true,
  };
}

function documentReady(): Promise<void> {
  return document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }))
    : Promise.resolve();
}

function text(japanese: string, english: string, language = preferences().language): string {
  return resolveCardLanguage(language) === "ja" ? japanese : english;
}

function publish(request: UserscriptRequest, status: JobStatus, detail?: string, answer?: UserscriptReply["answer"], progressText?: string): void {
  if (status === "generating" && Date.now() >= request.job.createdAt + MAX_JOB_AGE_MS) return;
  const reply: UserscriptReply = {
    jobId: request.job.id, sourceTabId: request.job.sourceTabId, status, updatedAt: Date.now(),
    ...(detail ? { detail: detail.slice(0, 500) } : {}), ...(answer ? { answer } : {}),
    ...(progressText !== undefined ? { progressText: progressText.slice(0, MAX_ANSWER_TEXT_LENGTH) } : {}),
  };
  GM_setValue(REPLY_KEY, reply);
}

async function startGemini(tab: Record<string, unknown>, workerId: string): Promise<void> {
  const existing = liveWorker(GM_getValue(WORKER_KEY, null));
  if (existing && existing.id !== workerId) {
    return;
  }
  tab.gsbWorkerId = workerId;
  GM_saveTab(tab);
  await documentReady();
  const notice = document.createElement("aside");
  notice.setAttribute("role", "note");
  notice.textContent = text(USERSCRIPT_USAGE_NOTICE,
    "Keep part of this Gemini window visible. Minimizing or fully covering it may pause processing. Use Open Gemini window in Google Search to return to it.");
  notice.style.cssText = "position:fixed;top:8px;right:8px;max-width:360px;padding:10px;border:1px solid #b8860b;border-radius:8px;background:Canvas;color:CanvasText;font:13px/1.5 Arial,sans-serif;z-index:2147483647;";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", text("この案内を閉じる", "Dismiss this notice"));
  dismiss.style.cssText = "float:right;margin-left:8px;border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px;";
  dismiss.addEventListener("click", () => notice.remove());
  notice.prepend(dismiss);
  const noticeMessage = document.createElement("span");
  noticeMessage.textContent = notice.lastChild?.textContent ?? "";
  notice.replaceChildren(dismiss, noticeMessage);
  document.body.append(notice);
  const adapter = new Phase2GeminiAdapter();
  let controller: AbortController | null = null;
  let activeRequest: UserscriptRequest | null = null;
  let progressText = "";
  let documentTransitioning = false;
  let lastFocusNonce = typeof tab.gsbFocusNonce === "string" ? tab.gsbFocusNonce : null;

  const currentRequest = (): UserscriptRequest | null => {
    const request = activeRequest ?? pendingRequest(GM_getValue(REQUEST_KEY, null));
    return request?.workerId === workerId ? request : null;
  };
  const surfaceReady = (request: UserscriptRequest | null): boolean => request?.usePip === true
    ? pip.visible() : document.visibilityState === "visible";
  const pip = new PipCompanion(window, surfaceChanged);
  pip.update(text("検索語を待機しています", "Waiting for a search query"), "");
  const pipControls = document.createElement("div");
  pipControls.style.cssText = "position:fixed;top:8px;right:8px;z-index:2147483647;background:Canvas;color:CanvasText;padding:6px;border:1px solid #b8860b;border-radius:8px;font:13px/1.5 Arial,sans-serif;max-width:360px;";
  const pipButton = document.createElement("button");
  pipButton.type = "button";
  const pipHint = document.createElement("span");
  pipHint.style.marginLeft = "8px";
  pipControls.append(pipButton, pipHint);
  document.body.append(pipControls);

  function updatePipControls(): void {
    const wanted = preferences().usePip || currentRequest()?.usePip === true;
    pipControls.hidden = !wanted;
    notice.style.top = wanted ? "54px" : "8px";
    pipButton.textContent = pip.visible() ? text("PiPを表示", "Show PiP") : text("PiPを開く", "Open PiP");
    noticeMessage.textContent = wanted ? text(
      "このボタンでGemini所有の小窓を開きます。Gemini本体は閉じず、PiPを表示したまま使ってください。描画継続の効果は実験中です。",
      "Open Gemini's companion window with this button. Keep Gemini and PiP open. Continued rendering is experimental.")
      : text(USERSCRIPT_USAGE_NOTICE, "Keep part of the Gemini window visible. Minimizing or fully covering it may pause processing.");
    if (!wanted) pip.close();
  }

  function surfaceChanged(): void {
    const request = currentRequest();
    if (activeRequest && tab.gsbRunPhase === "generating") {
      publish(activeRequest, "generating", visibilityDetail(), undefined, progressText);
    } else if (controller && !surfaceReady(request)) controller.abort();
    heartbeat();
    updatePipControls();
    if (surfaceReady(request)) void processRequest();
  }

  pipButton.addEventListener("click", async () => {
    pipButton.disabled = true;
    try {
      await pip.open();
      pipHint.textContent = text("実験用の補助表示", "Experimental companion");
    } catch {
      pipHint.textContent = text("PiPを開けません。このボタンをChromeで直接押すか、検索カードで通常方式に戻してください。",
        "Could not open PiP. Click this button directly in Chrome, or select normal mode in the search card.");
    } finally { pipButton.disabled = false; updatePipControls(); }
  });

  const visibilityDetail = (): string | undefined => surfaceReady(currentRequest()) ? undefined : currentRequest()?.usePip === true ? text(
    "PiPが閉じているため取得を待機中です。Gemini側の「PiPを開く」で再開してください。再送信はしません。",
    "Waiting for PiP. Reopen it using Open PiP in Gemini; the query will not be resent.") : text(
    "Geminiが非表示のため取得を待機中です。「Geminiウィンドウを開く」で戻ってください。再送信はしません。",
    "Waiting while Gemini is hidden. Use Open Gemini window to return; the query will not be resent.");

  const heartbeat = (): void => {
    const owner = liveWorker(GM_getValue(WORKER_KEY, null));
    if (owner && owner.id !== workerId) { controller?.abort(); return; }
    GM_setValue(WORKER_KEY, {
      id: workerId, seenAt: Date.now(), visible: document.visibilityState === "visible", busy: controller !== null || documentTransitioning, pipReady: pip.visible(),
    });
    const reply = GM_getValue<unknown>(REPLY_KEY, null);
    if (isUserscriptReply(reply) && Date.now() - reply.updatedAt > MAX_JOB_AGE_MS) {
      GM_deleteValue(REPLY_KEY);
    }
  };

  async function processRequest(): Promise<void> {
    const request = pendingRequest(GM_getValue(REQUEST_KEY, null));
    if (controller || documentTransitioning || !request || request.workerId !== workerId ||
        liveWorker(GM_getValue(WORKER_KEY, null))?.id !== workerId) return;
    if (!surfaceReady(request) && tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating") return;
    if (!preferences().consentAccepted || !surfaceReady(request)) {
      publish(request, "manual_intervention", text(
        request.usePip ? "Gemini側で「PiPを開く」を押し、小窓を表示してから再試行してください。" : "同意を確認し、Geminiウィンドウを最小化せず表示してから再試行してください。",
        request.usePip ? "Open PiP in Gemini before retrying." : "Review consent and restore the Gemini window before retrying."));
      GM_deleteValue(REQUEST_KEY);
      return;
    }
    if (tab.gsbRunId === request.job.id && tab.gsbRunPhase === "settled") {
      GM_deleteValue(REQUEST_KEY);
      return;
    }

    controller = new AbortController();
    activeRequest = request;
    const previous = GM_getValue<unknown>(REPLY_KEY, null);
    progressText = isUserscriptReply(previous) && previous.jobId === request.job.id ? previous.progressText ?? "" : "";
    const signal = controller.signal;
    heartbeat();
    try {
      if (tab.gsbRunId === request.job.id && tab.gsbRunPhase === "submitting") {
        throw new GeminiAdapterError("manual_intervention", text(
          "送信中にページが切り替わりました。Geminiで送信状況を確認してください。重複送信は行いません。",
          "The page changed during submission. Check Gemini before retrying; this script will not resend automatically."));
      }
      let baseline = { nodes: [] as readonly Element[], lastText: "" };
      let submittedAt = typeof tab.gsbSubmittedAt === "number" ? tab.gsbSubmittedAt : Date.now();
      const resume = tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating";
      if (!resume) {
        const newJob = tab.gsbRunId !== request.job.id;
        tab.gsbRunId = request.job.id;
        tab.gsbRunPhase = "preparing";
        GM_saveTab(tab);
        if (!request.usePip && newJob && (location.pathname !== "/app" || findFirstSelector(document, GEMINI_SELECTORS.conversationTurns))) {
          publish(request, "starting_new_chat");
          documentTransitioning = true;
          location.replace(GEMINI_APP);
          return;
        }
        publish(request, "loading_gemini");
        await adapter.waitUntilReady(signal);
        if (!surfaceReady(request)) throw new GeminiAdapterError("manual_intervention", visibilityDetail() ?? "Restore the selected surface.");
        publish(request, "starting_new_chat");
        await adapter.startNewChat(signal);
        if (!surfaceReady(request)) throw new GeminiAdapterError("manual_intervention", visibilityDetail() ?? "Restore the selected surface.");
        publish(request, "filling_prompt");
        await adapter.fillPrompt(buildPrompt(request.job.query, "raw"), signal);
        if (!surfaceReady(request)) throw new GeminiAdapterError("manual_intervention", visibilityDetail() ?? "Restore the selected surface.");
        baseline = captureAnswerBaseline(document);
        tab.gsbRunPhase = "submitting";
        GM_saveTab(tab);
        publish(request, "submitting");
        await adapter.submit(signal);
        submittedAt = Date.now();
        tab.gsbSubmittedAt = submittedAt;
        tab.gsbRunPhase = "generating";
        GM_saveTab(tab);
      }
      publish(request, "generating");
      pip.update(text("生成中…", "Generating…"), progressText);
      let lastProgressAt = 0;
      const root = await observeAnswerCompletion(document, baseline, submittedAt, signal, undefined, {
        pauseWhenHidden: true,
        deadlineAt: request.job.createdAt + MAX_JOB_AGE_MS,
        isSurfaceVisible: () => surfaceReady(request),
        onText(snapshot) {
          progressText = snapshot.slice(0, MAX_ANSWER_TEXT_LENGTH);
          pip.update(text("生成中…", "Generating…"), progressText);
          if (Date.now() - lastProgressAt < 250) return;
          lastProgressAt = Date.now();
          publish(request, "generating", visibilityDetail(), undefined, progressText);
        },
      });
      const answer = extractStructuredAnswer(root, {
        jobId: request.job.id, sourceTabId: request.job.sourceTabId, completedAt: Date.now(),
      });
      publish(request, "completed", undefined, answer);
      pip.update(text("回答が完了しました", "Answer completed"), answer.plainText);
      tab.gsbRunPhase = "settled";
    } catch (error) {
      const code = tab.gsbRunPhase === "submitting" ? "manual_intervention" : error instanceof GeminiAdapterError || error instanceof AnswerObserverError
        ? error.code : "failed";
      const unavailable = !surfaceReady(request);
      publish(request, unavailable && code === "failed" ? "manual_intervention" : code, tab.gsbRunPhase === "submitting"
        ? text("送信状況を確認できません。Geminiで既存のチャットを確認してください。自動再送信はしません。",
          "Submission could not be confirmed. Check the existing Gemini chat; this script will not resend automatically.") : unavailable
        ? visibilityDetail() ?? text("選択した表示方式を確認してから再試行してください。", "Restore the selected surface before retrying.")
        : error instanceof Error ? error.message : "Gemini operation failed.");
      pip.update(text("Geminiで必要な操作を確認してください", "Check Gemini for required actions"), progressText);
      tab.gsbRunPhase = "settled";
    } finally {
      controller = null;
      activeRequest = null;
      GM_saveTab(tab);
      if (tab.gsbRunPhase === "settled") {
        const current = GM_getValue<unknown>(REQUEST_KEY, null);
        if (isUserscriptRequest(current) && current.job.id === request.job.id) GM_deleteValue(REQUEST_KEY);
      }
      heartbeat();
      updatePipControls();
    }
  }

  document.addEventListener("visibilitychange", surfaceChanged);
  GM_addValueChangeListener(SETTINGS_KEY, updatePipControls);
  GM_addValueChangeListener(REQUEST_KEY, () => {
    const current = pendingRequest(GM_getValue(REQUEST_KEY, null));
    if (documentTransitioning && !current) { documentTransitioning = false; heartbeat(); }
    if (activeRequest && current?.job.id !== activeRequest.job.id) controller?.abort();
    else void processRequest();
    updatePipControls();
  });
  const focusRequested = (value: unknown): void => {
    if (!isFocusRequest(value) || value.workerId !== workerId || value.nonce === lastFocusNonce ||
        storedWorker(GM_getValue(WORKER_KEY, null))?.id !== workerId) return;
    lastFocusNonce = value.nonce;
    tab.gsbFocusNonce = value.nonce;
    GM_saveTab(tab);
    // Tampermonkey's granted focus targets this tab and window, even without an opener reference.
    try { window.focus(); } catch { /* The acknowledgement below reports whether focus actually changed. */ }
    window.setTimeout(() => {
      if (!isFocusRequest(value)) return;
      heartbeat();
      GM_setValue(FOCUS_ACK_KEY, { ...value, checkedAt: Date.now(), visible: document.visibilityState === "visible", hasFocus: document.hasFocus() });
    }, 500);
  };
  GM_addValueChangeListener(FOCUS_KEY, (_key, _old, value) => focusRequested(value));
  heartbeat();
  updatePipControls();
  focusRequested(GM_getValue(FOCUS_KEY, null));
  void processRequest();
  window.setInterval(() => { heartbeat(); void processRequest(); }, 3_000);
}

async function startGoogle(tab: Record<string, unknown>): Promise<void> {
  await documentReady();
  if (document.getElementById("gemini-search-bridge-root")) return;
  const sourceTabId = isPositiveTabId(tab.gsbSourceTabId)
    ? tab.gsbSourceTabId : crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
  tab.gsbSourceTabId = sourceTabId;
  let settings = preferences();
  let job: QueryJob | null = isQueryJob(tab.gsbActiveJob) && tab.gsbActiveJob.sourceTabId === sourceTabId &&
    tab.gsbActiveJob.query === readGoogleQuery() && Date.now() - tab.gsbActiveJob.createdAt < MAX_JOB_AGE_MS
    ? tab.gsbActiveJob : null;
  let lastReply: UserscriptReply | null = null;
  let localError: string | null = null;
  let popup: Window | null = null;
  let autoTimer: number | undefined;
  let pendingFocus: UserscriptFocusRequest | null = null;
  let focusTimer: number | undefined;

  function saveJob(): void {
    tab.gsbActiveJob = job;
    GM_saveTab(tab);
  }

  function openWorker(usePip = false): string {
    const worker = storedWorker(GM_getValue(WORKER_KEY, null));
    if (worker) {
      if ((usePip ? !worker.pipReady : !worker.visible) || !liveWorker(worker)) throw new Error(text(
        usePip ? "Gemini側で「PiPを開く」を押してから再試行してください。" : "「Geminiウィンドウを開く」で既存ウィンドウを表示してから再試行してください。",
        usePip ? "Click Open PiP in Gemini before retrying." : "Use Open Gemini window to restore the existing window before retrying."));
      return worker.id;
    }
    const workerId = crypto.randomUUID();
    popup = window.open(`${GEMINI_APP}#gsb-worker=${workerId}`, WORKER_TARGET,
      "popup,width=480,height=720");
    if (!popup) throw new Error(text(
      "ポップアップがブロックされました。このGoogle検索サイトのポップアップを許可し、もう一度ボタンを押してください。",
      "Allow popups for this Google Search site, then press the button again."));
    return workerId;
  }

  function render(): void {
    const language = resolveCardLanguage(settings.language);
    card.setPreferences(language, settings.language, settings.autoRun, "popup_window", false);
    if (!readGoogleQuery()) { card.remove(); return; }
    card.mount();
    openButton.textContent = text("Geminiウィンドウを開く", "Open Gemini window", settings.language);
    pipToggle.checked = settings.usePip;
    pipToggle.disabled = job !== null || pendingRequest(GM_getValue(REQUEST_KEY, null)) !== null;
    pipLabelText.textContent = text("PiP方式（実験）", "PiP mode (experimental)", settings.language);
    pipInstructions.hidden = !settings.usePip;
    pipInstructions.textContent = text("Gemini側の「PiPを開く」を直接押して小窓を有効にしてください。閉じた場合も同じボタンで再開できます。",
      "Activate the companion by clicking Open PiP in Gemini. Use the same button to reopen it.", settings.language);
    if (!settings.consentAccepted) card.renderConsent();
    else if (localError) card.renderError(localError, undefined, true, false);
    else if (lastReply?.answer) card.renderAnswer(lastReply.answer);
    else if (lastReply?.status === "generating" && (lastReply.progressText !== undefined || lastReply.detail)) {
      card.renderStreaming(lastReply.progressText ?? "", lastReply.detail);
    }
    else if (lastReply) {
      if (["manual_intervention", "not_logged_in", "rate_limited", "selector_not_found", "timed_out", "failed"].includes(lastReply.status)) {
        card.renderError(lastReply.detail ?? lastReply.status, undefined, lastReply.status !== "rate_limited", false);
      } else card.renderStatus(lastReply.status, lastReply.detail);
    } else if (job) card.renderStatus("loading_gemini");
    else card.renderReady();
    if (settings.usePip) {
      const note = card.host.shadowRoot?.querySelector('[role="note"]');
      if (note) note.textContent = text("PiP小窓とGemini本体を開いたまま使ってください。完全に覆われた状態での生成継続は実験中です。",
        "Keep PiP and Gemini open. Continued generation while Gemini is covered is experimental.", settings.language);
    }
  }

  function receiveReply(value: unknown): void {
    if (!job || !isUserscriptReply(value) || value.jobId !== job.id ||
        value.sourceTabId !== sourceTabId || job.query !== readGoogleQuery()) return;
    lastReply = value;
    render();
    if (value.status === "completed" || ["manual_intervention", "not_logged_in", "rate_limited", "selector_not_found", "timed_out", "failed"].includes(value.status)) {
      job = null;
      saveJob();
      GM_deleteValue(REPLY_KEY);
    }
  }

  async function run(mode: "manual" | "auto"): Promise<void> {
    try {
      settings = preferences();
      const query = readGoogleQuery();
      if (!settings.consentAccepted || !query) return;
      // ponytail: one shared pending job; automatic mode waits, manual callers retry.
      const pending = pendingRequest(GM_getValue(REQUEST_KEY, null));
      if (pending) throw new Error(text("別の検索を処理中です。回答が表示されてから再試行してください。",
        "Another search is running. Retry after its answer appears."));
      const worker = liveWorker(GM_getValue(WORKER_KEY, null));
      if (mode === "auto" && (!worker || !(settings.usePip ? worker.pipReady : worker.visible))) throw new Error(text(
        settings.usePip ? "Gemini側で「PiPを開く」を押してから自動送信を使ってください。" : "最初に「Geminiで生成」を押してウィンドウを開き、最小化せず表示してください。",
        settings.usePip ? "Open PiP in Gemini before using automatic sending." : "First press Generate with Gemini to open its window, and keep it visible."));
      if (worker?.busy) throw new Error(text("Geminiは処理中です。少し待ってから再試行してください。",
        "Gemini is busy. Wait before retrying."));
      const workerId = openWorker(settings.usePip);
      job = createQueryJob({ sourceTabId, query, sourceUrl: location.href, mode, promptMode: "raw" });
      lastReply = null;
      localError = null;
      if (mode === "auto") tab.gsbLastAutoQuery = query;
      saveJob();
      GM_deleteValue(REPLY_KEY);
      GM_setValue(REQUEST_KEY, { workerId, job, usePip: settings.usePip } satisfies UserscriptRequest);
      render();
    } catch (error) {
      localError = error instanceof Error ? error.message : "Could not start Gemini.";
      render();
    }
  }

  function scheduleAuto(): void {
    window.clearTimeout(autoTimer);
    const query = readGoogleQuery();
    if (!settings.consentAccepted || !settings.autoRun || !query || job || query === tab.gsbLastAutoQuery) return;
    autoTimer = window.setTimeout(() => {
      if (pendingRequest(GM_getValue(REQUEST_KEY, null))) { scheduleAuto(); return; }
      void run("auto");
    }, 600);
  }

  const unused = async (): Promise<void> => {};
  const card = new SearchCardView({
    async onAcceptConsent() {
      settings = { ...settings, consentAccepted: true, autoRun: false };
      GM_setValue(SETTINGS_KEY, settings);
      render();
    },
    onRunQuery: () => run("manual"),
    async onOpenFallback() { openWorker(); },
    async onRecreateWorker() { openWorker(); },
    async onAutoRunChange(enabled) {
      settings = { ...settings, autoRun: enabled };
      GM_setValue(SETTINGS_KEY, settings);
      render();
      scheduleAuto();
    },
    async onLanguageChange(language) {
      settings = { ...settings, language };
      GM_setValue(SETTINGS_KEY, settings);
      render();
    },
    onExecutionSurfaceChange: unused, onDownloadTrace: unused, onResetTrace: unused,
  }, true);
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.style.marginBottom = "8px";
  const openHint = document.createElement("p");
  openHint.setAttribute("role", "status");
  openHint.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:8px;";
  const pipLabel = document.createElement("label");
  pipLabel.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:0 0 8px 12px;font-size:13px;";
  const pipToggle = document.createElement("input");
  pipToggle.type = "checkbox";
  pipToggle.dataset.pipMode = "true";
  const pipLabelText = document.createElement("span");
  pipLabel.append(pipToggle, pipLabelText);
  const pipInstructions = document.createElement("p");
  pipInstructions.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:8px;";
  pipToggle.addEventListener("change", () => {
    window.clearTimeout(autoTimer);
    settings = { ...preferences(), usePip: pipToggle.checked, autoRun: false };
    localError = null;
    GM_setValue(SETTINGS_KEY, settings);
    render();
  });
  openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    try {
      const worker = storedWorker(GM_getValue(WORKER_KEY, null));
      if (!worker) {
        if (popup && !popup.closed) popup.focus(); else openWorker();
        openButton.disabled = false;
        openHint.textContent = text("Geminiウィンドウを開きました。", "Opened the Gemini window.");
      } else {
        const tabs = await new Promise<Record<string, Record<string, unknown>>>((resolve) => GM_getTabs(resolve));
        if (storedWorker(GM_getValue(WORKER_KEY, null))?.id !== worker.id) {
          throw new Error(text("ウィンドウの状態が変わりました。もう一度ボタンを押してください。", "The worker changed. Press the button again."));
        }
        if (!Object.values(tabs).some((entry) => entry && entry.gsbWorkerId === worker.id)) {
          const request = GM_getValue<unknown>(REQUEST_KEY, null);
          if (isUserscriptRequest(request) && request.workerId === worker.id) {
            publish(request, "manual_intervention", text("Geminiウィンドウが閉じられ、前の生成は中断しました。復旧で検索語は再送信していません。",
              "The Gemini window was closed and the previous job was interrupted. Recovery did not resend the query."));
            GM_deleteValue(REQUEST_KEY);
          }
          GM_deleteValue(WORKER_KEY);
          window.clearTimeout(autoTimer);
          if (job || lastReply?.status === "generating") lastReply = null;
          job = null; saveJob();
          openWorker();
          openButton.disabled = false;
          openHint.textContent = text("閉じられていたため新しいウィンドウを開きました。検索語は再送信していません。", "The old window was closed. Opened a new one without resending the query.");
        } else {
          pendingFocus = { workerId: worker.id, nonce: crypto.randomUUID(), createdAt: Date.now() };
          openHint.textContent = text("既存のGeminiウィンドウへ戻っています…", "Returning to the existing Gemini window…");
          GM_setValue(FOCUS_KEY, pendingFocus);
          focusTimer = window.setTimeout(() => {
            pendingFocus = null; openButton.disabled = false;
            openHint.textContent = text("復旧を確認できませんでした。Tampermonkey 5.5以降とwindow.focusの許可を確認し、タスクバーから表示してください。", "Recovery was not confirmed. Check Tampermonkey 5.5+ and the window.focus grant, or restore it from the taskbar.");
          }, 8_000);
        }
      }
      localError = null;
      render();
    } catch (error) {
      openButton.disabled = false;
      openHint.textContent = error instanceof Error ? error.message : "Could not open Gemini.";
    }
  });
  card.host.shadowRoot?.insertBefore(openButton, card.host.shadowRoot.querySelector("article"));
  card.host.shadowRoot?.insertBefore(pipLabel, card.host.shadowRoot.querySelector("article"));
  card.host.shadowRoot?.insertBefore(openHint, card.host.shadowRoot.querySelector("article"));
  card.host.shadowRoot?.insertBefore(pipInstructions, card.host.shadowRoot.querySelector("article"));
  GM_addValueChangeListener(REQUEST_KEY, () => {
    pipToggle.disabled = job !== null || pendingRequest(GM_getValue(REQUEST_KEY, null)) !== null;
  });
  GM_addValueChangeListener(FOCUS_ACK_KEY, (_key, _old, value) => {
    if (!pendingFocus || !isFocusAck(value) || value.nonce !== pendingFocus.nonce || value.workerId !== pendingFocus.workerId) return;
    pendingFocus = null; window.clearTimeout(focusTimer); openButton.disabled = false;
    openHint.textContent = value.visible && value.hasFocus
      ? text("Geminiから表示とフォーカスの確認が届きました。", "Gemini confirmed visibility and focus.")
      : text("フォーカス要求は届きましたが、表示を確認できません。タスクバーから復元してください。", "The focus request arrived, but visibility was not confirmed. Restore the window from the taskbar.");
  });
  GM_addValueChangeListener(REPLY_KEY, (_key, _old, value) => receiveReply(value));
  GM_addValueChangeListener(SETTINGS_KEY, () => { settings = preferences(); render(); scheduleAuto(); });
  observeGoogleQuery(() => {
    job = null; lastReply = null; localError = null; saveJob(); render(); scheduleAuto();
  });
  saveJob();
  render();
  receiveReply(GM_getValue(REPLY_KEY, null));
  scheduleAuto();
  window.setInterval(() => {
    if (!job) return;
    receiveReply(GM_getValue(REPLY_KEY, null));
    if (!job) return;
    const worker = liveWorker(GM_getValue(WORKER_KEY, null));
    if (Date.now() - job.createdAt >= MAX_JOB_AGE_MS) {
      localError = text("Geminiウィンドウとの接続を確認できません。開いたまま表示し、必要な操作を済ませて再試行してください。",
        "Cannot reach Gemini. Keep its window open and visible, complete any required actions, then retry.");
      const pending = GM_getValue<unknown>(REQUEST_KEY, null);
      if (isUserscriptRequest(pending) && pending.job.id === job.id) GM_deleteValue(REQUEST_KEY);
      job = null; saveJob(); render();
    } else if (!worker && Date.now() - job.createdAt > 35_000) {
      const detail = text("Geminiの応答確認を待っています。「Geminiウィンドウを開く」で表示してください。検索語は再送信しません。", "Waiting for Gemini. Use Open Gemini window to restore it; the query will not be resent.");
      card.renderStreaming(lastReply?.progressText ?? "", detail);
    }
  }, 3_000);
}

if (window.top === window) {
  GM_getTab((tab) => {
    const workerId = isWorkerId(initialWorkerId) ? initialWorkerId : tab.gsbWorkerId;
    if (location.hostname === "gemini.google.com" && isWorkerId(workerId)) {
      void startGemini(tab, workerId);
    } else if (readGoogleQuery()) {
      void startGoogle(tab);
    }
  });
}
