// ==UserScript==
// @name         Gemini Search Bridge
// @namespace    https://github.com/H4M4CHi-ttr/gemini-in-search
// @version      0.5.0
// @description  Show Gemini Web answers in Google Search with a visible PiP companion.
// @description:ja PiP小窓を使ってGoogle検索にGeminiの途中回答を表示します。
// @homepageURL  https://github.com/H4M4CHi-ttr/gemini-in-search-userscript
// @supportURL   https://github.com/H4M4CHi-ttr/gemini-in-search-userscript/issues
// @match        https://www.google.com/search*
// @match        https://www.google.co.jp/search*
// @match        https://gemini.google.com/app*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        GM_registerMenuCommand
// @grant        window.focus
// @license      MIT
// ==/UserScript==
(function() {
	//#region src/content/google/query-observer.ts
	var GOOGLE_SEARCH_HOSTS = /* @__PURE__ */ new Set(["www.google.com", "www.google.co.jp"]);
	var MAX_QUERY_LENGTH$1 = 4096;
	function isSupportedGoogleSearchUrl(url) {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "https:" && GOOGLE_SEARCH_HOSTS.has(parsed.hostname) && parsed.pathname === "/search";
		} catch {
			return false;
		}
	}
	function readGoogleQuery(url = location.href) {
		if (!isSupportedGoogleSearchUrl(url)) return null;
		const query = new URL(url).searchParams.get("q")?.trim();
		return query ? query.slice(0, MAX_QUERY_LENGTH$1) : null;
	}
	function observeGoogleQuery(onChange, debounceMs = 600) {
		let lastUrl = location.href;
		let timerId;
		const checkUrl = () => {
			if (location.href === lastUrl) return;
			lastUrl = location.href;
			onChange(readGoogleQuery(lastUrl), lastUrl);
		};
		const scheduleCheck = () => {
			if (timerId !== void 0) window.clearTimeout(timerId);
			timerId = window.setTimeout(checkUrl, debounceMs);
		};
		const observer = new MutationObserver(scheduleCheck);
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true
		});
		window.addEventListener("popstate", scheduleCheck);
		window.addEventListener("hashchange", scheduleCheck);
		return () => {
			observer.disconnect();
			window.removeEventListener("popstate", scheduleCheck);
			window.removeEventListener("hashchange", scheduleCheck);
			if (timerId !== void 0) window.clearTimeout(timerId);
		};
	}
	//#endregion
	//#region src/shared/query-models.ts
	var MAX_QUERY_LENGTH = 4096;
	var MAX_SOURCE_URL_LENGTH = 8192;
	var JOB_STATUSES = [
		"queued",
		"panel_required",
		"preparing_frame",
		"loading_gemini",
		"gemini_ready",
		"starting_new_chat",
		"filling_prompt",
		"submitting",
		"generating",
		"completed",
		"manual_intervention",
		"not_logged_in",
		"rate_limited",
		"frame_blocked",
		"selector_not_found",
		"timed_out",
		"cancelled",
		"failed"
	];
	function isRecord$1(value) {
		return typeof value === "object" && value !== null;
	}
	function isBoundedString$1(value, minimum, maximum) {
		return typeof value === "string" && value.length >= minimum && value.length <= maximum;
	}
	function isPositiveTabId(value) {
		return Number.isInteger(value) && typeof value === "number" && value > 0;
	}
	function isJobStatus(value) {
		return typeof value === "string" && JOB_STATUSES.includes(value);
	}
	function isQueryJob(value) {
		if (!isRecord$1(value)) return false;
		const validPanelSessionId = value.panelSessionId === void 0 || isBoundedString$1(value.panelSessionId, 1, 128);
		return isBoundedString$1(value.id, 1, 128) && isPositiveTabId(value.sourceTabId) && isBoundedString$1(value.query, 1, 4096) && isBoundedString$1(value.sourceUrl, 1, 8192) && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt > 0 && (value.mode === "manual" || value.mode === "auto") && value.conversationMode === "new_chat" && (value.promptMode === "raw" || value.promptMode === "research") && validPanelSessionId;
	}
	function createQueryJob(input, dependencies = {
		createId: () => crypto.randomUUID(),
		now: () => Date.now()
	}) {
		const query = input.query.trim().slice(0, MAX_QUERY_LENGTH);
		const sourceUrl = input.sourceUrl.slice(0, MAX_SOURCE_URL_LENGTH);
		if (!isPositiveTabId(input.sourceTabId)) throw new Error("A positive source tab id is required.");
		if (!query) throw new Error("A non-empty query is required.");
		if (!sourceUrl) throw new Error("A source URL is required.");
		const job = {
			id: dependencies.createId(),
			sourceTabId: input.sourceTabId,
			query,
			sourceUrl,
			createdAt: dependencies.now(),
			mode: input.mode,
			conversationMode: "new_chat",
			promptMode: input.promptMode
		};
		if (!isQueryJob(job)) throw new Error("Could not create a valid query job.");
		return job;
	}
	//#endregion
	//#region src/shared/answer-models.ts
	var MAX_ANSWER_TEXT_LENGTH$1 = 2e5;
	var MAX_ANSWER_BLOCK_TEXT_LENGTH$1 = 5e4;
	function isRecord(value) {
		return typeof value === "object" && value !== null;
	}
	function isBoundedString(value, minimum, maximum) {
		return typeof value === "string" && value.length >= minimum && value.length <= maximum;
	}
	function sanitizeHttpUrl$1(value) {
		if (value.length < 1 || value.length > 8192) return null;
		try {
			const parsed = new URL(value);
			return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
		} catch {
			return null;
		}
	}
	function isAnswerBlock(value) {
		if (!isRecord(value)) return false;
		if (value.type === "paragraph" || value.type === "quote") return isBoundedString(value.text, 1, MAX_ANSWER_BLOCK_TEXT_LENGTH$1);
		if (value.type === "heading") return (value.level === 1 || value.level === 2 || value.level === 3) && isBoundedString(value.text, 1, 5e4);
		if (value.type === "code") return isBoundedString(value.code, 1, 5e4) && (value.language === void 0 || isBoundedString(value.language, 1, 64));
		if (value.type === "list") return typeof value.ordered === "boolean" && Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= 500 && value.items.every((item) => isBoundedString(item, 1, 5e4));
		return false;
	}
	function isSafeLink(value) {
		return isRecord(value) && isBoundedString(value.label, 1, 1e3) && typeof value.url === "string" && sanitizeHttpUrl$1(value.url) === value.url;
	}
	function isStructuredAnswer(value) {
		if (!isRecord(value)) return false;
		return isBoundedString(value.jobId, 1, 128) && isPositiveTabId(value.sourceTabId) && Array.isArray(value.blocks) && value.blocks.length >= 1 && value.blocks.length <= 500 && value.blocks.every(isAnswerBlock) && isBoundedString(value.plainText, 1, 2e5) && Array.isArray(value.links) && value.links.length <= 100 && value.links.every(isSafeLink) && typeof value.completedAt === "number" && Number.isFinite(value.completedAt) && value.completedAt > 0 && (value.modelLabel === void 0 || isBoundedString(value.modelLabel, 1, 200));
	}
	//#endregion
	//#region src/shared/conversation-url.ts
	/** Only a native Gemini conversation is a completed-answer destination. */
	function sanitizeConversationUrl(value) {
		return typeof value === "string" && value.length <= 4096 && /^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/[A-Za-z0-9_-]+$/.test(value) ? value : null;
	}
	//#endregion
	//#region src/userscript/preferences.ts
	var PREFERENCES_KEY = "gsb-userscript:preferences";
	var PROMPT_PLACEHOLDER = "%%prompt%%";
	var DEFAULT_TEMPLATES = {
		ja: "ウェブ検索し参照を明示: %%prompt%%",
		en: "Search the web and cite your sources: %%prompt%%"
	};
	function readPreferences() {
		const stored = typeof GM_getValue === "function" ? GM_getValue(PREFERENCES_KEY, null) : null;
		const value = typeof stored === "object" && stored !== null ? stored : {};
		return {
			version: 1,
			language: value.language === "ja" || value.language === "en" ? value.language : "auto",
			promptTemplate: typeof value.promptTemplate === "string" ? value.promptTemplate : null
		};
	}
	function resolveLanguage(setting, browserLanguage) {
		return setting === "auto" ? browserLanguage.toLowerCase().startsWith("ja") ? "ja" : "en" : setting;
	}
	function getLanguage() {
		return resolveLanguage(readPreferences().language, browserLanguage());
	}
	function browserLanguage() {
		return typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "ja";
	}
	function validateTemplate(template) {
		if (!template.includes("%%prompt%%")) throw new Error("テンプレートに %%prompt%% を含めてください。");
		if (template.length > 4096) throw new Error("テンプレートは4096文字以内にしてください。");
	}
	function savePreferences(next) {
		if (![
			"auto",
			"ja",
			"en"
		].includes(next.language)) throw new Error("表示言語を選択してください。");
		if (next.promptTemplate !== null) validateTemplate(next.promptTemplate);
		const value = {
			version: 1,
			...next
		};
		GM_setValue(PREFERENCES_KEY, value);
		return value;
	}
	function formatPrompt(query, preferences = readPreferences(), language = resolveLanguage(preferences.language, browserLanguage())) {
		const template = preferences.promptTemplate ?? DEFAULT_TEMPLATES[language];
		validateTemplate(template);
		const prompt = template.split(PROMPT_PLACEHOLDER).join(query);
		if (!prompt.trim() || prompt.length > 16384) throw new Error("送信プロンプトは16384文字以内にしてください。");
		return prompt;
	}
	//#endregion
	//#region src/userscript/protocol.ts
	var REQUEST_KEY = "gsb-userscript:v5:request";
	var REPLY_KEY = "gsb-userscript:v4:reply";
	var WORKER_KEY = "gsb-userscript:v4:worker";
	var SETTINGS_KEY = "gsb-userscript:v4:settings";
	var FOCUS_KEY = "gsb-userscript:v4:focus";
	var FOCUS_ACK_KEY = "gsb-userscript:v4:focus-ack";
	var RECEIPTS_KEY = "gsb-userscript:v4:receipts";
	var MAX_JOB_AGE_MS = 3e5;
	function record(value) {
		return typeof value === "object" && value !== null;
	}
	function isWorkerId(value) {
		return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
	}
	function isUserscriptJob(value) {
		return isQueryJob(value) && "promptText" in value && typeof value.promptText === "string" && value.promptText.trim().length > 0 && value.promptText.length <= 16384;
	}
	function isUserscriptRequest(value) {
		return record(value) && isWorkerId(value.workerId) && isUserscriptJob(value.job) && value.version === 5 && readGoogleQuery(value.job.sourceUrl) === value.job.query;
	}
	function isUserscriptReply(value) {
		if (!record(value) || typeof value.jobId !== "string" || value.jobId.length < 1 || value.jobId.length > 128 || !Number.isInteger(value.sourceTabId) || typeof value.sourceTabId !== "number" || value.sourceTabId < 1 || !isJobStatus(value.status) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0 || value.detail !== void 0 && (typeof value.detail !== "string" || value.detail.length > 500) || value.progressText !== void 0 && (value.status !== "generating" || typeof value.progressText !== "string" || value.progressText.length > 2e5) || value.conversationUrl !== void 0 && (sanitizeConversationUrl(value.conversationUrl) !== value.conversationUrl || value.status !== "generating" && value.status !== "completed")) return false;
		return value.status === "completed" ? isStructuredAnswer(value.answer) && value.answer.jobId === value.jobId && value.answer.sourceTabId === value.sourceTabId : value.answer === void 0;
	}
	function storedWorker(value) {
		return record(value) && isWorkerId(value.id) && typeof value.seenAt === "number" && Number.isFinite(value.seenAt) && value.seenAt > 0 && typeof value.visible === "boolean" && typeof value.busy === "boolean" && (value.pipReady === void 0 || typeof value.pipReady === "boolean") ? value : null;
	}
	function liveWorker(value, now = Date.now()) {
		const worker = storedWorker(value);
		return worker && now >= worker.seenAt && now - worker.seenAt <= 2e4 ? worker : null;
	}
	function isFocusRequest(value, now = Date.now()) {
		return record(value) && isWorkerId(value.workerId) && isWorkerId(value.nonce) && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt > 0 && now >= value.createdAt && now - value.createdAt < 1e4;
	}
	function isFocusAck(value, now = Date.now()) {
		return record(value) && isFocusRequest(value, now) && typeof value.checkedAt === "number" && value.checkedAt >= value.createdAt && value.checkedAt <= now && typeof value.visible === "boolean" && typeof value.hasFocus === "boolean";
	}
	function pendingRequest(value, now = Date.now()) {
		return isUserscriptRequest(value) && now >= value.job.createdAt && now - value.job.createdAt < 3e5 ? value : null;
	}
	//#endregion
	//#region src/userscript/i18n.ts
	var EN = {
		"検索語を待っています": "Waiting for a search",
		"更新前の検索は自動再送信しません。Geminiで送信状況を確認してから、必要なら「この検索を再送信」を押してください。": "Searches started before the update will not be automatically resent. Check their state in Gemini, then use Send this search again if needed.",
		"既存のGeminiウィンドウを再読み込みし、PiPを開き直してください。更新前のウィンドウには送信しません。": "Reload the existing Gemini owner and reopen PiP. Searches will not be sent to an outdated owner.",
		"Geminiウィンドウを開く": "Open Gemini window",
		"この検索を再送信": "Send this search again",
		"Geminiを開いて会話を続ける": "Continue this conversation in Gemini",
		"もっと見る": "Show more",
		"折りたたむ": "Show less",
		"出典": "Sources",
		"Geminiに戻る": "Return to Gemini",
		"Gemini": "Gemini",
		"GoogleのAI モードをGeminiに置き換え": "Google AI Mode replaced with Gemini",
		"小窓を開いて、検索に戻る。": "Open the companion. Return to search.",
		"Geminiの回答をGoogle検索に表示します。最初に、この画面からPiP小窓を開いてください。": "See Gemini answers in Google Search. Start by opening the PiP companion here.",
		"ボタンを押すと、Google検索の検索語をGeminiへ自動送信することに同意します。送信には、ログイン中のGoogleアカウントのGemini画面を使います。会話はGeminiの履歴設定に従って保存され、ご利用プランの制限が適用されます。APIキーは不要です。": "By clicking, you agree to automatically send Google search queries to Gemini using your signed-in account. Conversations follow Gemini's history settings and your plan's limits apply. No API key is needed.",
		"PiP小窓が表示されている間は、このウィンドウを最小化できます。閉じないでください。": "While the PiP companion stays visible, you may minimize this owner window. Do not close it.",
		"小窓を開いたら、Google検索のタブに戻って検索してください。回答は検索カードに表示されます。": "Return to your Google Search tab after opening the companion. Answers appear in the search card.",
		"PiP小窓を開く": "Open the PiP companion",
		"Google検索に戻る": "Return to Google Search",
		"この画面のボタンを直接押します。": "Click the button on this page.",
		"小窓とGemini本体は開いたまま使います。": "Keep the companion and Gemini owner open.",
		"PiP小窓は表示中です": "PiP companion is open",
		"PiPを開いて自動送信を開始": "Open PiP and start automatic sending",
		"PiPを閉じて自動送信を停止": "Close PiP and pause automatic sending",
		"PiP小窓を開くまで、自動送信は停止しています。": "Automatic sending is paused until you open PiP.",
		"このブラウザーではPiPを利用できないため、自動送信は停止しています。Chromeで開いてください。": "PiP is unavailable in this browser. Automatic sending is paused. Open this page in Chrome.",
		"小窓を表示しています": "Companion is visible",
		"小窓の開始を待っています": "Waiting for the companion",
		"検索と並べて使える、Geminiの小窓。": "A small Gemini companion beside your search.",
		"Gemini画面を確認": "View Gemini",
		"小窓の設定を開く": "Open companion settings",
		"生成中…": "Generating…",
		"生成中": "Generating",
		"回答が完了しました": "Answer complete",
		"Geminiの確認が必要です": "Gemini needs your attention",
		"Geminiに送信しています…": "Sending to Gemini…",
		"Geminiとの接続を待っています…": "Waiting for the Gemini connection…",
		"Gemini側でPiP小窓を開いてください": "Open the PiP companion in Gemini",
		"前の回答の完了を待っています…": "Waiting for the previous answer…",
		"前の結果を復元できません。検索語は再送信していません。Geminiで送信状況を確認してから、必要なら「この検索を再送信」を押してください。": "The previous result could not be restored. Nothing was resent. Check the existing conversation in Gemini, then use Send this search again if needed.",
		"接続を確認できていません。「Geminiウィンドウを開く」で本体を表示してください。検索語は再送信しません。": "The connection could not be confirmed. Use Open Gemini window to show its owner. Nothing will be resent.",
		"Geminiへの送信を開始できませんでした。": "Could not start sending to Gemini.",
		"Geminiの必要な操作を済ませ、PiPを表示し、実行中の回答が終わってから再送信してください。": "Complete any required actions in Gemini, show PiP, and wait for the current answer before resending.",
		"ポップアップがブロックされました。このGoogle検索サイトのポップアップを許可し、もう一度押してください。": "The popup was blocked. Allow popups for this Google Search site, then click again.",
		"ウィンドウの状態が変わりました。もう一度押してください。": "The window state changed. Please click again.",
		"Geminiウィンドウが閉じられました。前の検索語は再送信しません。": "The Gemini owner was closed. The previous search will not be resent.",
		"新しいウィンドウを開きました。前の検索語は再送信しません。": "A new owner window was opened. The previous search will not be resent.",
		"既存のGeminiウィンドウを表示しています…": "Showing the existing Gemini window…",
		"表示を確認できませんでした。Tampermonkey 5.5以降とwindow.focusの許可を確認し、タスクバーから復元してください。": "Could not confirm the window is visible. Check Tampermonkey 5.5 or later and its window.focus permission, then restore Gemini from the taskbar.",
		"Geminiを開けませんでした。": "Could not open Gemini.",
		"復元を確認できません。タスクバーからGeminiを表示してください。": "Could not confirm restoration. Show Gemini from the taskbar.",
		"Geminiとの接続を確認してください。前の検索語は自動再送信しません。": "Check the Gemini connection. The previous search will not be automatically resent.",
		"PiPを開くと、この検索と次の検索を自動送信します。": "Opening PiP enables automatic sending for this and subsequent searches.",
		"検索画面に戻って、そのまま検索を続けられます。": "Return to Google Search and keep searching.",
		"PiPを開けませんでした。Chromeでこのボタンを直接押してください。": "Could not open PiP. Click this button directly in Chrome.",
		"PiPが閉じているため取得を待機中です。Gemini側で小窓を開くと再開します。再送信はしません。": "Answer capture is paused because PiP is closed. Reopen the companion in Gemini to resume. Nothing will be resent.",
		"この検索の会話URLを確認できません。Geminiで既存のチャットを確認してください。自動再送信はしません。": "Could not verify this search's conversation. Check the existing chat in Gemini. Nothing will be automatically resent.",
		"受理済みの検索です。Geminiで送信状況を確認してください。自動再送信はしません。": "This search was already accepted. Check its state in Gemini. Nothing will be automatically resent.",
		"送信中にページが切り替わりました。Geminiで送信状況を確認してください。自動再送信はしません。": "The page changed during submission. Check the existing chat in Gemini. Nothing will be automatically resent.",
		"新規チャットの準備を確認できませんでした。": "Could not verify a fresh chat.",
		"準備中に会話が変わりました。送信を停止しました。": "The conversation changed during preparation. Sending was stopped.",
		"生成中の会話が変わりました。取り違えを防ぐため取得を停止しました。自動再送信はしません。": "The conversation changed during generation. Capture was stopped to prevent mixing answers. Nothing will be automatically resent.",
		"生成中です。PiP小窓を表示したまま検索に戻れます。": "Generating. Keep PiP visible and return to your search.",
		"会話が変わったため回答取得を停止しました。": "Capture stopped because the conversation changed.",
		"回答を検索画面に表示しました。次の検索も自動送信します。": "The answer is shown in Google Search. Subsequent searches will also be sent automatically.",
		"送信を確認できません。既存のチャットを確認してください。自動再送信はしません。": "Submission could not be confirmed. Check the existing chat. Nothing will be automatically resent.",
		"Geminiの操作に失敗しました。": "The Gemini operation failed.",
		"Geminiで必要な操作を確認してください。自動再送信はしません。": "Check Gemini for any required action. Nothing will be automatically resent.",
		"テンプレートに %%prompt%% を含めてください。": "Include %%prompt%% in the template.",
		"テンプレートは4096文字以内にしてください。": "Keep the template within 4,096 characters.",
		"送信プロンプトは16384文字以内にしてください。": "Keep the submitted prompt within 16,384 characters.",
		"表示言語を選択してください。": "Choose a display language."
	};
	function translate(message, language = getLanguage()) {
		return language === "en" ? EN[message] ?? message : message;
	}
	function localized(ja, en) {
		return getLanguage() === "en" ? en : ja;
	}
	//#endregion
	//#region src/content/google/card-view.ts
	var sanitizeCardLink = sanitizeHttpUrl$1;
	var CARD_CSS = `
  :host { display:block; margin:0 0 20px; max-width:760px; color:#243149;
    font-family:"Yu Gothic UI","Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif; }
  :host([data-floating="true"]) { position:fixed; right:16px; bottom:16px;
    z-index:2147483646; width:min(640px,calc(100vw - 32px)); max-height:75vh; overflow:auto; }
  * { box-sizing:border-box; }
  article { border:1px solid #D8E0EF; border-top:3px solid #415FC8;
    border-radius:8px; padding:18px 20px; background:white; }
  button,a { font:inherit; font-size:14px; }
  button { min-height:44px; padding:9px 16px; border:1px solid #415FC8;
    border-radius:6px; background:#415FC8; color:white; font-weight:600; cursor:pointer; }
  button:hover { background:#243149; }
  button:focus-visible,a:focus-visible { outline:3px solid #415FC8; outline-offset:3px; }
  [hidden] { display:none !important; }
  .output { margin-top:16px; }
  article[data-compact="true"] .output { margin-top:0; }
  button.owner.compact { display:block; min-height:32px; margin:12px 0 0 auto; padding:5px 10px;
    border-color:#D8E0EF; background:white; color:#677386; font-size:12px; font-weight:400; }
  button.owner.compact:hover { background:#F2F5FC; color:#243149; }
  .status { font-size:14px; font-weight:600; margin:0; }
  .detail { margin:6px 0 0; font-size:13px; line-height:1.6; }
  .answer { display:grid; gap:12px; margin-top:14px; overflow-wrap:anywhere;
    font-size:15px; line-height:1.8; }
  .answer p,.answer h3,.answer h4,.answer h5 { margin:0; }
  .answer h3 { font-size:19px; } .answer h4 { font-size:17px; } .answer h5 { font-size:15px; }
  .answer ul,.answer ol { margin:0; padding-left:24px; }
  .answer pre { margin:0; padding:12px; overflow:auto; background:#F2F5FC;
    border-radius:4px; font:13px/1.6 ui-monospace,Consolas,monospace; }
  .answer blockquote { margin:0; border-left:3px solid #D8E0EF; padding-left:12px; }
  .streaming { white-space:pre-wrap; }
  .preview { position:relative; max-height:min(210px,27.5vh); overflow:hidden; }
  .preview[data-expanded="true"] { max-height:none; overflow:visible; }
  .preview[data-clipped="true"]::after { content:""; position:absolute; inset:auto 0 0;
    height:32px; background:linear-gradient(transparent,white); pointer-events:none; }
  .preview[data-clipped="true"] .sources { visibility:hidden; }
  button.expand { display:block; width:100%; margin-top:12px; border-color:#D8E0EF;
    border-radius:24px; background:white; color:#243149; }
  button.expand:hover { background:#F2F5FC; }
  .sources { margin-top:18px; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
  .sources ul { margin:6px 0 0; padding-left:20px; }
  a { color:#415FC8; text-underline-offset:3px; }
  .conversation { display:flex; align-items:center; justify-content:center; width:100%; min-height:44px;
    padding:9px 16px; margin-top:12px; border:1px solid #415FC8; border-radius:6px;
    background:#F2F5FC; font-weight:600; text-align:center; text-decoration:none; }
  .conversation:hover { background:#E8EEFA; }
  button.retry { display:block; margin-top:12px; background:white; color:#415FC8; }
  @media (max-width:480px) { article { padding:14px; } .answer { font-size:14px; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
`;
	function textElement(tag, text, className = "") {
		const element = document.createElement(tag);
		element.textContent = text;
		element.className = className;
		return element;
	}
	function externalLink(label, url) {
		const anchor = textElement("a", label);
		anchor.href = url;
		anchor.target = "_blank";
		anchor.rel = "noopener noreferrer";
		return anchor;
	}
	function renderBlock(block) {
		if (block.type === "paragraph") return textElement("p", block.text);
		if (block.type === "quote") return textElement("blockquote", block.text);
		if (block.type === "heading") return textElement(block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5", block.text);
		if (block.type === "code") {
			const pre = document.createElement("pre");
			pre.append(textElement("code", block.code));
			return pre;
		}
		const list = document.createElement(block.ordered ? "ol" : "ul");
		for (const item of block.items) list.append(textElement("li", item));
		return list;
	}
	var SearchCardView = class {
		onRetry;
		host;
		card;
		button;
		output;
		lastState = "";
		currentJob;
		expanded = false;
		compact = false;
		previewObserver;
		constructor(onOpen, onRetry) {
			this.onRetry = onRetry;
			this.host = document.createElement("div");
			this.host.id = "gemini-search-bridge-root";
			const shadow = this.host.attachShadow({ mode: "open" });
			const style = textElement("style", CARD_CSS);
			const card = this.card = document.createElement("article");
			card.lang = getLanguage();
			card.setAttribute("aria-label", "Gemini");
			this.button = textElement("button", translate("Geminiウィンドウを開く"), "owner");
			this.button.type = "button";
			this.button.addEventListener("click", onOpen);
			this.output = document.createElement("div");
			this.output.className = "output";
			this.output.hidden = true;
			card.append(this.button, this.output);
			shadow.append(style, card);
		}
		mount() {
			if (this.host.isConnected) return;
			const results = document.querySelector("#rso");
			if (results) {
				this.host.dataset.floating = "false";
				results.prepend(this.host);
				return;
			}
			const anchor = document.querySelector("#rso, #search, #center_col, [role='main']");
			if (anchor?.parentElement) {
				this.host.dataset.floating = "false";
				anchor.before(this.host);
			} else {
				this.host.dataset.floating = "true";
				document.body.append(this.host);
			}
		}
		remove() {
			this.previewObserver?.disconnect();
			this.host.remove();
		}
		render(state = {}) {
			const signature = JSON.stringify([getLanguage(), state]);
			if (signature === this.lastState) return;
			this.lastState = signature;
			this.card.lang = getLanguage();
			this.button.textContent = translate("Geminiウィンドウを開く");
			const jobId = state.jobId ?? state.answer?.jobId;
			if (jobId !== this.currentJob || !state.answer && !state.progressText) this.expanded = false;
			this.currentJob = jobId;
			this.previewObserver?.disconnect();
			const compact = state.pipReady === true || !!(state.answer?.blocks.some(isAnswerBlock) || state.progressText?.trim()) && !state.detail && !state.canRetry;
			if (compact !== this.compact) {
				this.compact = compact;
				this.card.dataset.compact = String(compact);
				this.button.className = compact ? "owner compact" : "owner";
				this.card.replaceChildren(...compact ? [this.output, this.button] : [this.button, this.output]);
			}
			const nodes = [];
			let preview;
			let body;
			let sources;
			let expander;
			let conversation;
			this.button.setAttribute("aria-busy", String(state.busy === true));
			if (state.status) {
				const status = textElement("p", translate(state.status), "status");
				status.setAttribute("role", "status");
				nodes.push(status);
			}
			if (state.detail) nodes.push(textElement("p", translate(state.detail), "detail"));
			if (state.canRetry && this.onRetry) {
				const retry = textElement("button", translate("この検索を再送信"), "retry");
				retry.type = "button";
				retry.addEventListener("click", this.onRetry);
				nodes.push(retry);
			}
			if (state.answer) {
				preview = document.createElement("div");
				body = document.createElement("div");
				const answer = document.createElement("div");
				answer.className = "answer";
				for (const block of state.answer.blocks) if (isAnswerBlock(block)) answer.append(renderBlock(block));
				body.append(answer);
				sources = document.createElement("section");
				sources.className = "sources";
				const list = document.createElement("ul");
				for (const link of state.answer.links) {
					const url = sanitizeCardLink(link.url);
					if (!url) continue;
					const item = document.createElement("li");
					item.append(externalLink(link.label, url));
					list.append(item);
				}
				if (list.childElementCount) {
					sources.append(textElement("p", translate("出典")), list);
					body.append(sources);
				}
			} else if (state.progressText) {
				preview = document.createElement("div");
				body = document.createElement("div");
				const streaming = textElement("div", state.progressText, "answer streaming");
				streaming.setAttribute("aria-live", "off");
				body.append(streaming);
			}
			if (preview && body) {
				preview.className = "preview";
				preview.id = "gemini-answer-preview";
				preview.append(body);
				expander = textElement("button", translate("もっと見る"), "expand");
				expander.type = "button";
				expander.hidden = true;
				expander.setAttribute("aria-controls", preview.id);
				nodes.push(preview);
			}
			const url = sanitizeConversationUrl(state.conversationUrl);
			if (url) {
				conversation = externalLink(translate("Geminiを開いて会話を続ける"), url);
				conversation.className = "conversation";
				nodes.push(conversation);
			}
			if (expander) nodes.push(expander);
			this.output.replaceChildren(...nodes);
			this.output.hidden = nodes.length === 0;
			if (preview && body && expander) {
				const viewport = preview;
				const content = body;
				const toggle = expander;
				const updatePreview = () => {
					const overflowing = viewport.scrollHeight > Math.min(210, window.innerHeight * .275) + 1;
					const clipped = overflowing && !this.expanded;
					const expanded = String(this.expanded);
					const label = translate(this.expanded ? "折りたたむ" : "もっと見る");
					if (viewport.dataset.expanded !== expanded) viewport.dataset.expanded = expanded;
					if (viewport.dataset.clipped !== String(clipped)) viewport.dataset.clipped = String(clipped);
					if (sources && sources.inert !== clipped) sources.inert = clipped;
					if (conversation && conversation.hidden !== clipped) conversation.hidden = clipped;
					if (toggle.hidden === overflowing) toggle.hidden = !overflowing;
					if (toggle.textContent !== label) toggle.textContent = label;
					if (toggle.getAttribute("aria-expanded") !== expanded) toggle.setAttribute("aria-expanded", expanded);
				};
				toggle.addEventListener("click", () => {
					this.expanded = !this.expanded;
					updatePreview();
				});
				if (typeof ResizeObserver !== "undefined") {
					this.previewObserver = new ResizeObserver(updatePreview);
					this.previewObserver.observe(content);
					this.previewObserver.observe(viewport);
				}
				updatePreview();
			}
		}
	};
	//#endregion
	//#region src/shared/gemini-icon.ts
	var GEMINI_ICON = "https://www.google.com/s2/favicons?sz=128&domain=gemini.google.com";
	//#endregion
	//#region src/content/google/search-overrides.ts
	var AI_MODULES = "#m-x-content, [data-attrid=\"AIOverview\"], [data-attrid=\"ai_overview\"]";
	var PROTECTED_RESULTS = "#search, #rso, #center_col, #rcnt, #hdtb, main, [role=\"main\"], #gemini-search-bridge-root";
	var HIDDEN_MARK = "data-gsb-ai-hidden";
	var NAV_MARK = "data-gsb-ai-replaced";
	var GEMINI_APP$1 = "https://gemini.google.com/app";
	var normalizeLabel = (label) => label.trim().replace(/\s+/g, " ");
	function aiModuleRoot(marker) {
		if (marker.matches(PROTECTED_RESULTS) || marker.querySelector(PROTECTED_RESULTS)) return null;
		const shell = marker.id === "m-x-content" ? marker.closest("#eKIzJc.SePcAf") : null;
		if (!shell || shell.matches(PROTECTED_RESULTS) || shell.querySelector(PROTECTED_RESULTS)) return marker;
		const more = [...shell.querySelectorAll("[role=\"button\"][aria-label]")].some((button) => !marker.contains(button) && /^(?:その他の AI による概要を表示|Show more AI Overviews?)$/i.test(normalizeLabel(button.getAttribute("aria-label") ?? "")));
		const ordinaryResults = [...shell.querySelectorAll("h3, .MjjYud")].some((node) => !marker.contains(node));
		return more && !ordinaryResults ? shell : marker;
	}
	/** Keep Google's visual wrappers without copying its event or RPC attributes. */
	function navigationShape(original) {
		const label = normalizeLabel(original.textContent ?? "");
		let path = [];
		for (const candidate of original.querySelectorAll("div, span")) {
			if (normalizeLabel(candidate.textContent ?? "") !== label) continue;
			const ancestors = [];
			let node = candidate;
			while (node && node !== original && ["DIV", "SPAN"].includes(node.tagName)) {
				ancestors.unshift(node);
				node = node.parentElement;
			}
			if (node === original && ancestors.length > path.length) path = ancestors;
		}
		return [original, ...path].map((node) => ({
			tag: node.tagName.toLowerCase(),
			className: node.className
		}));
	}
	/** Require both Google's AI-mode destination and its exact navigation label. */
	function isAiModeLink(label, href, base) {
		if (![
			"AI モード",
			"AIモード",
			"AI Mode"
		].includes(normalizeLabel(label))) return false;
		try {
			const url = new URL(href, base);
			return url.protocol === "https:" && !url.username && !url.password && !url.port && ["www.google.com", "www.google.co.jp"].includes(url.hostname) && url.pathname === "/search" && url.searchParams.get("udm") === "50";
		} catch {
			return false;
		}
	}
	var SearchOverrides = class {
		doc;
		style;
		observer;
		hidden = /* @__PURE__ */ new Set();
		navigation = /* @__PURE__ */ new Map();
		url = GEMINI_APP$1;
		stopped = false;
		constructor(doc = document) {
			this.doc = doc;
			this.style = doc.createElement("style");
			this.style.textContent = `
      [${HIDDEN_MARK}], [${NAV_MARK}] { display:none !important; }
      a[data-gsb-gemini-nav] { color:#70757A !important;
        position:relative; text-decoration:none; }
      a[data-gsb-gemini-nav] [data-gsb-gemini-label] { display:inline-block; position:relative;
        padding-inline-start:24px; color:inherit; font-weight:inherit; }
      a[data-gsb-gemini-nav] img { position:absolute; inset-inline-start:0; top:50%;
        transform:translateY(-50%); width:18px; height:18px; }
      a[data-gsb-gemini-nav]:focus-visible { outline:3px solid #415FC8; outline-offset:3px; }
    `;
			(doc.head ?? doc.documentElement).append(this.style);
			this.refresh();
			this.observer = new MutationObserver(() => this.refresh());
			this.observer.observe(doc.documentElement, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
				attributeFilter: [
					"href",
					"data-attrid",
					"id",
					"role",
					"class",
					"aria-label",
					"data-lhcontainer"
				]
			});
		}
		setConversationUrl(url) {
			if (this.stopped) return;
			this.url = sanitizeConversationUrl(url) ?? GEMINI_APP$1;
			this.refresh();
		}
		refreshLanguage() {
			this.refresh();
		}
		refresh() {
			if (this.stopped) return;
			const modules = new Set([...this.doc.querySelectorAll(AI_MODULES)].map(aiModuleRoot).filter((module) => module !== null));
			for (const module of this.hidden) if (!modules.has(module)) {
				module.removeAttribute(HIDDEN_MARK);
				this.hidden.delete(module);
			}
			for (const module of modules) if (!module.hasAttribute(HIDDEN_MARK)) {
				module.setAttribute(HIDDEN_MARK, "");
				this.hidden.add(module);
			}
			for (const [original, { replacement }] of this.navigation) if (!original.isConnected || !replacement.isConnected || !isAiModeLink(original.textContent ?? "", original.href, this.doc.baseURI)) {
				original.removeAttribute(NAV_MARK);
				replacement.remove();
				this.navigation.delete(original);
			}
			for (const original of this.doc.querySelectorAll("#hdtb a[href], nav a[href], [role=\"navigation\"] a[href]")) {
				if (original.hasAttribute("data-gsb-gemini-nav") || this.navigation.has(original) || !isAiModeLink(original.textContent ?? "", original.href, this.doc.baseURI)) continue;
				const replacement = this.doc.createElement("a");
				replacement.setAttribute("data-gsb-gemini-nav", "");
				replacement.target = "_blank";
				replacement.rel = "noopener noreferrer";
				original.setAttribute(NAV_MARK, "");
				original.after(replacement);
				this.navigation.set(original, {
					replacement,
					shape: ""
				});
			}
			for (const [original, entry] of this.navigation) {
				const { replacement } = entry;
				const title = translate("GoogleのAI モードをGeminiに置き換え");
				if (replacement.title !== title) replacement.title = title;
				const shape = navigationShape(original);
				const signature = JSON.stringify(shape);
				if (entry.shape !== signature) {
					if (replacement.className !== shape[0].className) replacement.className = shape[0].className;
					let label = null;
					let parent = null;
					for (const wrapper of shape.slice(1)) {
						const node = this.doc.createElement(wrapper.tag);
						if (wrapper.className) node.className = wrapper.className;
						if (parent) parent.append(node);
						else label = node;
						parent = node;
					}
					if (!parent) label = parent = this.doc.createElement("span");
					parent.setAttribute("data-gsb-gemini-label", "");
					const icon = this.doc.createElement("img");
					icon.setAttribute("referrerpolicy", "no-referrer");
					icon.setAttribute("src", GEMINI_ICON);
					icon.setAttribute("alt", "");
					icon.setAttribute("aria-hidden", "true");
					const text = this.doc.createElement("span");
					text.textContent = "Gemini";
					parent.replaceChildren(icon, text);
					replacement.replaceChildren(label);
					entry.shape = signature;
				}
				if (replacement.href !== this.url) replacement.href = this.url;
			}
		}
		stop() {
			this.stopped = true;
			this.observer.disconnect();
			this.style.remove();
			for (const module of this.hidden) module.removeAttribute(HIDDEN_MARK);
			for (const [original, { replacement }] of this.navigation) {
				original.removeAttribute(NAV_MARK);
				replacement.remove();
			}
			this.hidden.clear();
			this.navigation.clear();
		}
	};
	//#endregion
	//#region src/userscript/settings.ts
	function consentAccepted() {
		const value = GM_getValue(SETTINGS_KEY, null);
		return typeof value === "object" && value !== null && value.version === 4 && value.consentAccepted === true;
	}
	function acceptConsent() {
		GM_setValue(SETTINGS_KEY, {
			version: 4,
			consentAccepted: true
		});
	}
	function documentReady() {
		return document.readyState === "loading" ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })) : Promise.resolve();
	}
	//#endregion
	//#region src/userscript/search-queue.ts
	function searchSignature(search) {
		const url = new URL(search.sourceUrl);
		return `${url.origin}${url.pathname}\n${search.query}`;
	}
	/** One local latest-search slot. In-flight work is never replaced or resent. */
	var SearchQueue = class {
		lastDispatched;
		pending = null;
		constructor(lastDispatched = null) {
			this.lastDispatched = lastDispatched;
		}
		offer(search) {
			if (search && this.pending && searchSignature(search) === searchSignature(this.pending)) return;
			this.pending = search && searchSignature(search) !== this.lastDispatched ? search : null;
		}
		dispatched() {
			const search = this.pending;
			if (search) {
				this.lastDispatched = searchSignature(search);
				this.pending = null;
			}
			return search;
		}
	};
	//#endregion
	//#region src/userscript/receipts.ts
	function receipts(value, now = Date.now()) {
		const result = {};
		if (typeof value !== "object" || value === null) return result;
		for (const [id, entry] of Object.entries(value)) {
			if (typeof entry !== "object" || entry === null) continue;
			const item = entry;
			if (item.jobId !== id || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) || now < item.createdAt || now - item.createdAt >= 3e5 || !Number.isInteger(item.sourceTabId) || item.sourceTabId < 1) continue;
			result[id] = {
				jobId: id,
				sourceTabId: item.sourceTabId,
				createdAt: item.createdAt,
				...isUserscriptReply(item.reply) && item.reply.jobId === id && item.reply.sourceTabId === item.sourceTabId ? { reply: item.reply } : {}
			};
		}
		return result;
	}
	function readReceipt(job) {
		const entry = receipts(GM_getValue(RECEIPTS_KEY, null))[job.id];
		return entry && entry.sourceTabId === job.sourceTabId && entry.createdAt === job.createdAt ? entry : null;
	}
	/** Sole worker writes before touching Gemini; source tabs only read. */
	function writeReceipt(job, reply) {
		if (!isQueryJob(job)) return;
		const entries = receipts(GM_getValue(RECEIPTS_KEY, null));
		entries[job.id] = {
			jobId: job.id,
			sourceTabId: job.sourceTabId,
			createdAt: job.createdAt,
			...reply ? { reply } : {}
		};
		GM_setValue(RECEIPTS_KEY, entries);
	}
	function pruneReceipts() {
		const stored = GM_getValue(RECEIPTS_KEY, null);
		const entries = receipts(stored);
		if (typeof stored === "object" && stored !== null && Object.keys(stored).length !== Object.keys(entries).length) GM_setValue(RECEIPTS_KEY, entries);
	}
	//#endregion
	//#region src/userscript/google-flow.ts
	var GEMINI_APP = "https://gemini.google.com/app";
	var TERMINAL = /* @__PURE__ */ new Set([
		"completed",
		"manual_intervention",
		"not_logged_in",
		"rate_limited",
		"frame_blocked",
		"selector_not_found",
		"timed_out",
		"cancelled",
		"failed"
	]);
	async function startGoogle(tab) {
		await documentReady();
		if (document.getElementById("gemini-search-bridge-root")) return;
		const sourceTabId = isPositiveTabId(tab.gsbSourceTabId) ? tab.gsbSourceTabId : crypto.getRandomValues(/* @__PURE__ */ new Uint32Array(1))[0] || 1;
		tab.gsbSourceTabId = sourceTabId;
		function savedJob(value) {
			return isQueryJob(value) && value.sourceTabId === sourceTabId && readGoogleQuery(value.sourceUrl) === value.query ? value : null;
		}
		const storedJob = savedJob(tab.gsbV4ActiveJob);
		let job = storedJob && isUserscriptJob(storedJob) && Date.now() >= storedJob.createdAt && Date.now() - storedJob.createdAt < 3e5 ? storedJob : null;
		const queue = new SearchQueue(typeof tab.gsbV4LastDispatched === "string" ? tab.gsbV4LastDispatched : null);
		if (storedJob && !job) queue.lastDispatched = searchSignature(storedJob);
		const savedPending = tab.gsbV5PendingSearch;
		if (typeof savedPending === "object" && savedPending !== null) {
			const value = savedPending;
			if (typeof value.query === "string" && typeof value.sourceUrl === "string" && readGoogleQuery(value.sourceUrl) === value.query && typeof value.promptText === "string" && value.promptText.trim() && value.promptText.length <= 16384) queue.offer(value);
		}
		const storedLastJob = savedJob(tab.gsbV4LastJob) ?? storedJob;
		let lastJob = storedLastJob && Date.now() >= storedLastJob.createdAt && Date.now() - storedLastJob.createdAt < 3e5 ? storedLastJob : null;
		let reply = null;
		let acknowledged = job !== null && tab.gsbV4AcknowledgedJob === job.id;
		let detail = storedJob && !isUserscriptJob(storedJob) ? "更新前の検索は自動再送信しません。Geminiで送信状況を確認してから、必要なら「この検索を再送信」を押してください。" : void 0;
		let opening = false;
		let opened = false;
		let popup = null;
		let pendingFocus = null;
		let focusTimer;
		const card = new SearchCardView(() => {
			openWorker();
		}, retryCurrent);
		card.mount();
		const overrides = new SearchOverrides();
		let displayedSignature = currentSignature();
		function currentSignature() {
			const query = readGoogleQuery();
			return query ? searchSignature({
				query,
				sourceUrl: location.href
			}) : null;
		}
		function restoreDisplayedReply() {
			if (job || reply || !lastJob || searchSignature(lastJob) !== currentSignature()) return;
			const value = readReceipt(lastJob)?.reply;
			if (value && TERMINAL.has(value.status)) {
				reply = value;
				detail = void 0;
			}
		}
		function save() {
			tab.gsbV4ActiveJob = job;
			tab.gsbV4LastDispatched = queue.lastDispatched;
			tab.gsbV4AcknowledgedJob = acknowledged && job ? job.id : null;
			tab.gsbV4LastJob = lastJob;
			tab.gsbV5PendingSearch = queue.pending;
			GM_saveTab(tab);
		}
		function render() {
			const existing = storedWorker(GM_getValue(WORKER_KEY, null));
			const worker = liveWorker(GM_getValue(WORKER_KEY, null));
			const status = reply?.status === "completed" ? void 0 : reply?.status === "generating" ? "生成中…" : reply && TERMINAL.has(reply.status) ? "Geminiの確認が必要です" : job ? "Geminiに送信しています…" : queue.pending && existing && !worker ? "Geminiとの接続を待っています…" : (opened || queue.pending && existing) && !worker?.pipReady ? "Gemini側でPiP小窓を開いてください" : queue.pending && consentAccepted() && worker?.pipReady && worker.busy ? "前の回答の完了を待っています…" : void 0;
			const consumedWithoutResult = !job && !reply && queue.lastDispatched === currentSignature();
			const recoveryDetail = consumedWithoutResult ? "前の結果を復元できません。検索語は再送信していません。Geminiで送信状況を確認してから、必要なら「この検索を再送信」を押してください。" : queue.pending && existing && !worker ? "接続を確認できていません。「Geminiウィンドウを開く」で本体を表示してください。検索語は再送信しません。" : void 0;
			const protocolDetail = existing && existing.protocolVersion !== 5 ? "既存のGeminiウィンドウを再読み込みし、PiPを開き直してください。更新前のウィンドウには送信しません。" : void 0;
			const message = detail ?? reply?.detail ?? protocolDetail ?? recoveryDetail;
			card.render({
				jobId: job?.id ?? reply?.jobId ?? reply?.answer?.jobId,
				...status ? { status } : {},
				...message ? { detail: message } : {},
				...reply?.progressText ? { progressText: reply.progressText } : {},
				...reply?.answer ? { answer: reply.answer } : {},
				conversationUrl: reply?.conversationUrl ?? null,
				busy: opening,
				pipReady: consentAccepted() && worker?.protocolVersion === 5 && worker.pipReady === true,
				canRetry: !job && !opening && (consumedWithoutResult || !!reply && reply.status !== "completed" && TERMINAL.has(reply.status))
			});
			overrides.setConversationUrl(reply?.conversationUrl ?? null);
		}
		function offerCurrent() {
			const query = readGoogleQuery();
			const search = query ? {
				query,
				sourceUrl: location.href
			} : null;
			if (search && queue.pending && searchSignature(search) === searchSignature(queue.pending)) return;
			if (!search || searchSignature(search) === queue.lastDispatched) {
				queue.offer(null);
				save();
				return;
			}
			try {
				queue.offer({
					...search,
					promptText: formatPrompt(search.query)
				});
			} catch (error) {
				queue.offer(null);
				detail = error instanceof Error ? error.message : "Geminiへの送信を開始できませんでした。";
			}
			save();
		}
		function dispatchLatest() {
			const worker = liveWorker(GM_getValue(WORKER_KEY, null));
			const shared = pendingRequest(GM_getValue(REQUEST_KEY, null));
			if (job && !acknowledged) {
				if (readReceipt(job)) acknowledge();
				else if (!shared && worker?.protocolVersion === 5 && worker.pipReady && !worker.busy && consentAccepted()) GM_setValue(REQUEST_KEY, {
					workerId: worker.id,
					job,
					version: 5
				});
			}
			if (job || !queue.pending || !consentAccepted() || !worker?.pipReady || worker.protocolVersion !== 5 || worker.busy || pendingRequest(GM_getValue("gsb-userscript:v5:request", null))) {
				render();
				return;
			}
			startPending(worker.id, "auto");
		}
		function startPending(workerId, mode) {
			const next = queue.pending;
			if (!next || job) return;
			try {
				job = {
					...createQueryJob({
						sourceTabId,
						query: next.query,
						sourceUrl: next.sourceUrl,
						mode,
						promptMode: "raw"
					}),
					promptText: next.promptText
				};
				acknowledged = false;
				reply = null;
				detail = void 0;
				save();
				GM_setValue(REQUEST_KEY, {
					workerId,
					job,
					version: 5
				});
			} catch (error) {
				detail = error instanceof Error ? error.message : "Geminiへの送信を開始できませんでした。";
				acknowledge();
				job = null;
				save();
			}
			render();
		}
		function retryCurrent() {
			const query = readGoogleQuery();
			const worker = liveWorker(GM_getValue(WORKER_KEY, null));
			if (!query || job) return;
			if (!consentAccepted() || !worker?.pipReady || worker.protocolVersion !== 5 || worker.busy || pendingRequest(GM_getValue("gsb-userscript:v5:request", null))) {
				detail = "Geminiの必要な操作を済ませ、PiPを表示し、実行中の回答が終わってから再送信してください。";
				render();
				return;
			}
			try {
				queue.pending = {
					query,
					sourceUrl: location.href,
					promptText: formatPrompt(query)
				};
			} catch (error) {
				detail = error instanceof Error ? error.message : "Geminiへの送信を開始できませんでした。";
				render();
				return;
			}
			startPending(worker.id, "manual");
		}
		function acknowledge() {
			if (!job || acknowledged) return;
			acknowledged = true;
			lastJob = job;
			const signature = searchSignature(job);
			if (queue.pending && searchSignature(queue.pending) === signature) queue.dispatched();
			else queue.lastDispatched = signature;
			save();
		}
		function receiveReply(value) {
			if (!job || !isUserscriptReply(value) || value.jobId !== job.id || value.sourceTabId !== sourceTabId || value.updatedAt < job.createdAt) return;
			acknowledge();
			if (job.query === readGoogleQuery()) {
				reply = value;
				detail = void 0;
			}
			if (TERMINAL.has(value.status)) {
				job = null;
				save();
			}
			render();
			dispatchLatest();
		}
		function createWorker() {
			const id = crypto.randomUUID();
			popup = window.open(`${GEMINI_APP}#gsb-worker=${id}`, "GeminiSearchBridgeWorker", "popup,width=480,height=720");
			if (!popup) throw new Error("ポップアップがブロックされました。このGoogle検索サイトのポップアップを許可し、もう一度押してください。");
			opened = true;
			detail = void 0;
		}
		async function openWorker() {
			if (opening) return;
			opening = true;
			try {
				const worker = storedWorker(GM_getValue(WORKER_KEY, null));
				if (!worker) {
					if (popup && !popup.closed) popup.focus();
					else createWorker();
					opened = true;
				} else {
					const tabs = await new Promise((resolve) => GM_getTabs(resolve));
					if (storedWorker(GM_getValue("gsb-userscript:v4:worker", null))?.id !== worker.id) throw new Error("ウィンドウの状態が変わりました。もう一度押してください。");
					if (!Object.values(tabs).some((entry) => entry?.gsbWorkerId === worker.id)) {
						const request = GM_getValue(REQUEST_KEY, null);
						if (isUserscriptRequest(request) && request.workerId === worker.id) {
							GM_setValue(REPLY_KEY, {
								jobId: request.job.id,
								sourceTabId: request.job.sourceTabId,
								status: "manual_intervention",
								updatedAt: Date.now(),
								detail: "Geminiウィンドウが閉じられました。前の検索語は再送信しません。"
							});
							GM_deleteValue(REQUEST_KEY);
						}
						GM_deleteValue(WORKER_KEY);
						acknowledge();
						job = null;
						reply = null;
						save();
						createWorker();
						detail = "新しいウィンドウを開きました。前の検索語は再送信しません。";
					} else {
						opened = true;
						pendingFocus = {
							workerId: worker.id,
							nonce: crypto.randomUUID(),
							createdAt: Date.now()
						};
						detail = "既存のGeminiウィンドウを表示しています…";
						GM_setValue(FOCUS_KEY, pendingFocus);
						focusTimer = window.setTimeout(() => {
							pendingFocus = null;
							opening = false;
							detail = "表示を確認できませんでした。Tampermonkey 5.5以降とwindow.focusの許可を確認し、タスクバーから復元してください。";
							render();
						}, 8e3);
					}
				}
			} catch (error) {
				detail = error instanceof Error ? error.message : "Geminiを開けませんでした。";
			} finally {
				if (!pendingFocus) opening = false;
				render();
			}
		}
		GM_addValueChangeListener(FOCUS_ACK_KEY, (_key, _old, value) => {
			if (!pendingFocus || !isFocusAck(value) || value.nonce !== pendingFocus.nonce || value.workerId !== pendingFocus.workerId) return;
			pendingFocus = null;
			window.clearTimeout(focusTimer);
			opening = false;
			detail = value.visible && value.hasFocus ? void 0 : "復元を確認できません。タスクバーからGeminiを表示してください。";
			render();
		});
		GM_addValueChangeListener(REPLY_KEY, (_key, _old, value) => receiveReply(value));
		GM_addValueChangeListener(WORKER_KEY, dispatchLatest);
		GM_addValueChangeListener(REQUEST_KEY, dispatchLatest);
		GM_addValueChangeListener(SETTINGS_KEY, dispatchLatest);
		function preferencesChanged() {
			overrides.refreshLanguage();
			render();
			dispatchLatest();
		}
		GM_addValueChangeListener(PREFERENCES_KEY, preferencesChanged);
		window.addEventListener("gsb-preferences-changed", preferencesChanged);
		GM_addValueChangeListener(RECEIPTS_KEY, () => {
			if (job) {
				const entry = readReceipt(job);
				if (entry?.reply) receiveReply(entry.reply);
			}
			restoreDisplayedReply();
			dispatchLatest();
		});
		observeGoogleQuery(() => {
			const signature = currentSignature();
			if (signature === displayedSignature) return;
			displayedSignature = signature;
			reply = null;
			detail = void 0;
			restoreDisplayedReply();
			offerCurrent();
			render();
			dispatchLatest();
		});
		offerCurrent();
		save();
		restoreDisplayedReply();
		render();
		receiveReply(GM_getValue(REPLY_KEY, null));
		dispatchLatest();
		window.setInterval(() => {
			if (job) {
				const entry = readReceipt(job);
				if (entry?.reply) receiveReply(entry.reply);
			}
			restoreDisplayedReply();
			receiveReply(GM_getValue(REPLY_KEY, null));
			if (job && Date.now() - job.createdAt >= 3e5) {
				acknowledge();
				const pending = GM_getValue(REQUEST_KEY, null);
				if (isUserscriptRequest(pending) && pending.job.id === job.id) GM_deleteValue(REQUEST_KEY);
				job = null;
				save();
				detail = "Geminiとの接続を確認してください。前の検索語は自動再送信しません。";
			}
			dispatchLatest();
		}, 3e3);
	}
	//#endregion
	//#region src/content/gemini/gemini-selectors.ts
	var GEMINI_SELECTORS = {
		promptInputs: [
			"rich-textarea .ql-editor[contenteditable=\"true\"]",
			".ql-editor[contenteditable=\"true\"][role=\"textbox\"]",
			"div[contenteditable=\"true\"][role=\"textbox\"]",
			"div[contenteditable=\"true\"][aria-label*=\"prompt\" i]",
			"div[contenteditable=\"true\"][aria-label*=\"プロンプト\"]",
			"textarea"
		],
		sendButtons: [
			"button[aria-label=\"Send message\"]",
			"button[aria-label=\"メッセージを送信\"]",
			"button[aria-label=\"プロンプトを送信\"]",
			"button[aria-label*=\"送信\"]",
			"button[mattooltip=\"Send message\"]",
			"button[aria-label=\"Submit\"]",
			"button[type=\"submit\"]",
			"button.send-button"
		],
		stopButtons: [
			"button[aria-label=\"Stop response\"]",
			"button[aria-label=\"Stop generating\"]",
			"button[aria-label=\"Stop\"]",
			"button[aria-label*=\"回答を停止\"]",
			"button[aria-label*=\"生成を停止\"]",
			"button[aria-label*=\"停止\"]",
			"button[mattooltip=\"Stop response\"]",
			"[data-test-id=\"stop-button\"]"
		],
		modelResponses: [
			"model-response",
			"[data-test-id=\"model-response\"]",
			".model-response"
		],
		answerContents: [
			".markdown-main-panel",
			".model-response-text .markdown",
			"message-content .markdown",
			"message-content"
		],
		newChatButtons: [
			"a[aria-label=\"チャットを新規作成\"]",
			"a[aria-label=\"新しいチャット\"]",
			"button[aria-label=\"New chat\"]",
			"a[aria-label=\"New chat\"]",
			"button[aria-label*=\"新規チャット\"]",
			"a[aria-label*=\"新規チャット\"]"
		],
		conversationTurns: [
			"[data-test-id=\"conversation-turn\"]",
			"user-query",
			"model-response",
			".conversation-container user-query"
		],
		signedOutIndicators: [
			"a[href*=\"accounts.google.com/ServiceLogin\"]",
			"a[href*=\"accounts.google.com/signin\"]",
			"button[aria-label*=\"Sign in\" i]",
			"a[aria-label*=\"Sign in\" i]",
			"button[aria-label*=\"ログイン\"]",
			"a[aria-label*=\"ログイン\"]"
		],
		captchaIndicators: [
			"iframe[src*=\"recaptcha\" i]",
			"iframe[title*=\"recaptcha\" i]",
			"[data-test-id*=\"captcha\" i]",
			"[data-sitekey]",
			"[aria-label*=\"captcha\" i]",
			"[aria-label*=\"ロボットではない\"]"
		],
		rateLimitIndicators: [
			"[data-test-id=\"rate-limit\"]",
			"[data-test-id*=\"rate-limit\" i]",
			"[role=\"alert\"][aria-label*=\"usage limit\" i]",
			"[role=\"alert\"][aria-label*=\"rate limit\" i]",
			"[role=\"alert\"][aria-label*=\"利用上限\"]"
		],
		manualInterventionIndicators: [
			"[role=\"dialog\"][aria-modal=\"true\"]:not([aria-hidden=\"true\"])",
			"dialog[open]",
			"[role=\"dialog\"] [href*=\"policies.google.com/terms\"]",
			"[role=\"dialog\"][aria-label*=\"terms\" i]",
			"[role=\"dialog\"][aria-label*=\"利用規約\"]",
			"[data-test-id*=\"model-picker\" i][aria-expanded=\"true\"]"
		]
	};
	function findFirstSelector(root, selectors) {
		for (const selector of selectors) try {
			const element = root.querySelector(selector);
			if (element !== null) return {
				element,
				selector
			};
		} catch {}
		return null;
	}
	function detectGeminiSurface(root) {
		const promptInput = findFirstSelector(root, GEMINI_SELECTORS.promptInputs);
		const sendButton = findFirstSelector(root, GEMINI_SELECTORS.sendButtons);
		const signedOut = findFirstSelector(root, GEMINI_SELECTORS.signedOutIndicators);
		return {
			loginState: promptInput ? "logged_in" : signedOut ? "logged_out" : "unknown",
			promptInput,
			sendButton
		};
	}
	function detectGeminiBlockingState(root) {
		const captcha = findFirstSelector(root, GEMINI_SELECTORS.captchaIndicators);
		if (captcha) return {
			kind: "captcha",
			match: captcha
		};
		const rateLimit = findFirstSelector(root, GEMINI_SELECTORS.rateLimitIndicators);
		if (rateLimit) return {
			kind: "rate_limit",
			match: rateLimit
		};
		const manualIntervention = findFirstSelector(root, GEMINI_SELECTORS.manualInterventionIndicators);
		return manualIntervention ? {
			kind: "manual_intervention",
			match: manualIntervention
		} : null;
	}
	//#endregion
	//#region src/content/gemini/gemini-adapter.ts
	var READY_TIMEOUT_MS = 2e4;
	var NEW_CHAT_TIMEOUT_MS = 8e3;
	var SEND_BUTTON_TIMEOUT_MS = 3e3;
	var SUBMISSION_TIMEOUT_MS = 5e3;
	var POLL_INTERVAL_MS = 100;
	var GeminiAdapterError = class extends Error {
		code;
		constructor(code, message) {
			super(message);
			this.code = code;
			this.name = "GeminiAdapterError";
		}
	};
	function abortError$1() {
		return new DOMException("The Gemini operation was cancelled.", "AbortError");
	}
	function assertNotAborted(signal) {
		if (signal.aborted) throw abortError$1();
	}
	function throwIfAutomationBlocked() {
		const blocked = detectGeminiBlockingState(document);
		if (blocked?.kind === "captcha") throw new GeminiAdapterError("manual_intervention", `CAPTCHA detected at ${blocked.match.selector}. Automatic operation stopped; complete the check in Gemini.`);
		if (blocked?.kind === "rate_limit") throw new GeminiAdapterError("rate_limited", `Gemini usage limit detected at ${blocked.match.selector}. Automatic retry is disabled.`);
		if (blocked?.kind === "manual_intervention") throw new GeminiAdapterError("manual_intervention", `A Gemini terms, model, or modal confirmation is blocking automation at ${blocked.match.selector}. Complete it manually.`);
	}
	function wait(delayMs, signal) {
		assertNotAborted(signal);
		return new Promise((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, delayMs);
			const onAbort = () => {
				window.clearTimeout(timeoutId);
				reject(abortError$1());
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}
	async function waitFor(read, timeoutMs, signal) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() <= deadline) {
			assertNotAborted(signal);
			throwIfAutomationBlocked();
			const value = read();
			if (value !== null) return value;
			await wait(POLL_INTERVAL_MS, signal);
		}
		return null;
	}
	function promptElement(match) {
		if (match.element instanceof HTMLElement || match.element instanceof HTMLTextAreaElement) return match.element;
		throw new GeminiAdapterError("selector_not_found", "The detected Gemini prompt input is not editable.");
	}
	function readPromptValue(element) {
		return element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? "";
	}
	function dispatchInput(element, text) {
		element.dispatchEvent(new InputEvent("input", {
			bubbles: true,
			composed: true,
			inputType: "insertText",
			data: text
		}));
	}
	function setTextareaValue(element, text) {
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		if (setter) setter.call(element, text);
		else element.value = text;
		dispatchInput(element, text);
	}
	function replaceContentEditableText(element, text) {
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(element);
		selection?.removeAllRanges();
		selection?.addRange(range);
		let inserted = false;
		try {
			document.execCommand("selectAll", false);
			inserted = document.execCommand("insertText", false, text);
		} catch {
			inserted = false;
		}
		if (!inserted || readPromptValue(element) !== text) {
			element.textContent = text;
			const fallbackRange = document.createRange();
			fallbackRange.selectNodeContents(element);
			fallbackRange.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(fallbackRange);
		}
		dispatchInput(element, text);
	}
	function isEnabledButton(element) {
		if (!(element instanceof HTMLElement)) return false;
		if (element.getAttribute("aria-disabled") === "true") return false;
		return !(element instanceof HTMLButtonElement) || !element.disabled;
	}
	function findEnabledSendButton() {
		for (const selector of GEMINI_SELECTORS.sendButtons) {
			let candidates;
			try {
				candidates = document.querySelectorAll(selector);
			} catch {
				continue;
			}
			for (const candidate of candidates) if (isEnabledButton(candidate)) return candidate;
		}
		return null;
	}
	function hasConversation() {
		return location.pathname !== "/app" || findFirstSelector(document, GEMINI_SELECTORS.conversationTurns) !== null;
	}
	function submissionStarted(prompt) {
		return readPromptValue(prompt).trim().length === 0 || findFirstSelector(document, GEMINI_SELECTORS.stopButtons) !== null || findFirstSelector(document, GEMINI_SELECTORS.conversationTurns) !== null || location.pathname !== "/app";
	}
	var Phase2GeminiAdapter = class {
		async waitUntilReady(signal) {
			throwIfAutomationBlocked();
			const detection = await waitFor(() => {
				const current = detectGeminiSurface(document);
				return current.promptInput || current.loginState === "logged_out" ? current : null;
			}, READY_TIMEOUT_MS, signal);
			if (detection === null) throw new GeminiAdapterError("timed_out", "Gemini did not expose a prompt input before the timeout.");
			if (detection.loginState === "logged_out") throw new GeminiAdapterError("not_logged_in", "Gemini requires the user to sign in.");
		}
		getLoginState() {
			return detectGeminiSurface(document).loginState;
		}
		async startNewChat(signal) {
			assertNotAborted(signal);
			throwIfAutomationBlocked();
			if (!hasConversation()) return;
			const newChat = findFirstSelector(document, GEMINI_SELECTORS.newChatButtons);
			if (!(newChat?.element instanceof HTMLElement)) throw new GeminiAdapterError("manual_intervention", "A new Gemini chat could not be started automatically.");
			newChat.element.click();
			if (!await waitFor(() => {
				const detection = detectGeminiSurface(document);
				return !hasConversation() && detection.promptInput ? true : null;
			}, NEW_CHAT_TIMEOUT_MS, signal)) throw new GeminiAdapterError("timed_out", "Gemini did not finish opening a new chat.");
		}
		async fillPrompt(text, signal) {
			throwIfAutomationBlocked();
			const match = await waitFor(() => detectGeminiSurface(document).promptInput, READY_TIMEOUT_MS, signal);
			if (match === null) throw new GeminiAdapterError("selector_not_found", "Gemini prompt input was not found.");
			const element = promptElement(match);
			element.focus();
			if (element instanceof HTMLTextAreaElement) setTextareaValue(element, text);
			else replaceContentEditableText(element, text);
			if (readPromptValue(element) !== text) throw new GeminiAdapterError("selector_not_found", "Gemini prompt input did not retain the inserted text.");
		}
		async submit(signal) {
			throwIfAutomationBlocked();
			const promptMatch = detectGeminiSurface(document).promptInput;
			if (promptMatch === null) throw new GeminiAdapterError("selector_not_found", "Gemini prompt input was not found before submission.");
			const prompt = promptElement(promptMatch);
			const sendButton = await waitFor(findEnabledSendButton, SEND_BUTTON_TIMEOUT_MS, signal);
			if (sendButton) sendButton.click();
			else {
				prompt.dispatchEvent(new KeyboardEvent("keydown", {
					key: "Enter",
					code: "Enter",
					bubbles: true,
					composed: true
				}));
				prompt.dispatchEvent(new KeyboardEvent("keyup", {
					key: "Enter",
					code: "Enter",
					bubbles: true,
					composed: true
				}));
			}
			if (!await waitFor(() => submissionStarted(prompt) ? true : null, SUBMISSION_TIMEOUT_MS, signal)) throw new GeminiAdapterError("manual_intervention", "The prompt is filled, but Gemini did not confirm submission.");
		}
	};
	//#endregion
	//#region src/content/gemini/gemini-extractor.ts
	var MAX_ANSWER_TEXT_LENGTH = 2e5;
	var MAX_ANSWER_BLOCKS = 500;
	var MAX_ANSWER_BLOCK_TEXT_LENGTH = 5e4;
	var MAX_ANSWER_LIST_ITEMS = 500;
	var MAX_ANSWER_LINKS = 100;
	var MAX_ANSWER_LINK_LABEL_LENGTH = 1e3;
	var MAX_LINK_URL_LENGTH = 8192;
	var IGNORED_ANSWER_ELEMENTS = /* @__PURE__ */ new Set([
		"button",
		"source-footnote",
		"source-inline-chip",
		"sources-carousel-inline",
		"script",
		"style"
	]);
	function sanitizeHttpUrl(value) {
		if (value.length < 1 || value.length > MAX_LINK_URL_LENGTH) return null;
		try {
			const parsed = new URL(value);
			return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
		} catch {
			return null;
		}
	}
	function normalizeAnswerText(value) {
		return value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	}
	function normalizeCodeText(value) {
		return value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/^(?:[\t ]*\n)+/, "").replace(/(?:\n[\t ]*)+$/, "").slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH);
	}
	function boundedText(value) {
		return normalizeAnswerText(value).slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH);
	}
	function readElementText(element) {
		const clone = element.cloneNode(true);
		if (!(clone instanceof Element)) return "";
		for (const ignored of clone.querySelectorAll([...IGNORED_ANSWER_ELEMENTS].join(","))) ignored.remove();
		return boundedText(clone.textContent ?? "");
	}
	function languageFromElement(element) {
		const code = element.matches("code") ? element : element.querySelector("code");
		return (code ? [...code.classList].find((className) => className.startsWith("language-")) : void 0)?.slice(9, 64).trim() || void 0;
	}
	function normalizeDomNode(element) {
		const tag = element.tagName.toLowerCase();
		if (IGNORED_ANSWER_ELEMENTS.has(tag) || element.getAttribute("aria-hidden") === "true") return null;
		const children = [...element.children].map(normalizeDomNode).filter((child) => child !== null);
		const node = {
			tag,
			text: tag === "pre" ? normalizeCodeText((element.querySelector("code") ?? element).textContent ?? "") : readElementText(element),
			children
		};
		const language = languageFromElement(element);
		if (language) node.language = language;
		return node;
	}
	function pushBlock(blocks, block) {
		if (blocks.length < MAX_ANSWER_BLOCKS) blocks.push(block);
	}
	function collectBlocks(nodes, blocks) {
		for (const node of nodes) {
			if (blocks.length >= MAX_ANSWER_BLOCKS) return;
			if (!node.text && node.children.length === 0) continue;
			if (/^h[1-6]$/.test(node.tag) && node.text) {
				const rawLevel = Number(node.tag.slice(1));
				pushBlock(blocks, {
					type: "heading",
					level: Math.min(3, Math.max(1, rawLevel)),
					text: boundedText(node.text)
				});
				continue;
			}
			if (node.tag === "p" && node.text) {
				pushBlock(blocks, {
					type: "paragraph",
					text: boundedText(node.text)
				});
				continue;
			}
			if (node.tag === "blockquote" && node.text) {
				pushBlock(blocks, {
					type: "quote",
					text: boundedText(node.text)
				});
				continue;
			}
			if (node.tag === "pre" && node.text) {
				pushBlock(blocks, node.language ? {
					type: "code",
					language: node.language,
					code: node.text.slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH)
				} : {
					type: "code",
					code: node.text.slice(0, MAX_ANSWER_BLOCK_TEXT_LENGTH)
				});
				continue;
			}
			if (node.tag === "ul" || node.tag === "ol") {
				const items = node.children.filter((child) => child.tag === "li" && child.text).map((child) => boundedText(child.text)).slice(0, MAX_ANSWER_LIST_ITEMS);
				if (items.length > 0) pushBlock(blocks, {
					type: "list",
					ordered: node.tag === "ol",
					items
				});
				continue;
			}
			const blockCountBeforeChildren = blocks.length;
			collectBlocks(node.children, blocks);
			if (blocks.length === blockCountBeforeChildren && node.text && node.tag !== "li") pushBlock(blocks, {
				type: "paragraph",
				text: boundedText(node.text)
			});
		}
	}
	function blocksFromNormalizedNodes(nodes) {
		const blocks = [];
		collectBlocks(nodes, blocks);
		return blocks;
	}
	function plainTextFromBlocks(blocks) {
		return blocks.map((block) => {
			if (block.type === "list") return block.items.map((item, index) => block.ordered ? `${index + 1}. ${item}` : `- ${item}`).join("\n");
			return block.type === "code" ? block.code : block.text;
		}).join("\n\n").slice(0, MAX_ANSWER_TEXT_LENGTH).trim();
	}
	function findAnswerContent(responseRoot) {
		for (const selector of GEMINI_SELECTORS.answerContents) try {
			const match = responseRoot.querySelector(selector);
			if (match) return match;
		} catch {}
		return null;
	}
	function extractSafeLinks(content) {
		const links = [];
		const seen = /* @__PURE__ */ new Set();
		for (const anchor of content.querySelectorAll("a[href]")) {
			if (links.length >= MAX_ANSWER_LINKS) break;
			const url = sanitizeHttpUrl(anchor instanceof HTMLAnchorElement ? anchor.href : anchor.getAttribute("href") ?? "");
			if (!url) continue;
			let label = boundedText(anchor.textContent ?? "").slice(0, MAX_ANSWER_LINK_LABEL_LENGTH);
			if (!label) label = new URL(url).hostname.slice(0, MAX_ANSWER_LINK_LABEL_LENGTH);
			const key = `${label}\n${url}`;
			if (!seen.has(key)) {
				seen.add(key);
				links.push({
					label,
					url
				});
			}
		}
		return links;
	}
	function extractStructuredAnswer(responseRoot, metadata) {
		const content = findAnswerContent(responseRoot);
		if (!content) throw new Error("Gemini answer content was not found.");
		let blocks = blocksFromNormalizedNodes([...content.children].map(normalizeDomNode).filter((node) => node !== null));
		if (blocks.length === 0) {
			const fallbackText = readElementText(content);
			if (fallbackText) blocks = [{
				type: "paragraph",
				text: fallbackText
			}];
		}
		const plainText = plainTextFromBlocks(blocks);
		if (!plainText) throw new Error("Gemini answer text was empty.");
		return metadata.modelLabel ? {
			jobId: metadata.jobId,
			sourceTabId: metadata.sourceTabId,
			blocks,
			plainText,
			links: extractSafeLinks(content),
			completedAt: metadata.completedAt,
			modelLabel: metadata.modelLabel.slice(0, 200)
		} : {
			jobId: metadata.jobId,
			sourceTabId: metadata.sourceTabId,
			blocks,
			plainText,
			links: extractSafeLinks(content),
			completedAt: metadata.completedAt
		};
	}
	var COMPLETION_POLL_MS = 100;
	var AnswerObserverError = class extends Error {
		code;
		constructor(code, message) {
			super(message);
			this.code = code;
			this.name = "AnswerObserverError";
		}
	};
	function responseNodes(root) {
		const matches = [];
		const seen = /* @__PURE__ */ new Set();
		for (const selector of GEMINI_SELECTORS.modelResponses) try {
			for (const element of root.querySelectorAll(selector)) if (!seen.has(element)) {
				seen.add(element);
				matches.push(element);
			}
		} catch {}
		return matches;
	}
	function responseText(response) {
		if (!response) return "";
		return (findAnswerContent(response)?.textContent ?? "").trim();
	}
	function hasExplicitCompletion(response) {
		if (!response) return false;
		return findAnswerContent(response)?.getAttribute("aria-busy") === "false" || response.querySelector(".response-footer.complete") !== null;
	}
	function isVisible(element) {
		if (!(element instanceof HTMLElement)) return true;
		if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
		const style = getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden";
	}
	function hasVisibleStopButton(root) {
		for (const selector of GEMINI_SELECTORS.stopButtons) try {
			for (const element of root.querySelectorAll(selector)) if (isVisible(element)) return true;
		} catch {}
		return false;
	}
	function findCandidate(currentNodes, baseline) {
		const newNode = currentNodes.find((node) => !baseline.nodes.includes(node));
		if (newNode) return currentNodes.at(-1) ?? newNode;
		const lastNode = currentNodes.at(-1);
		return lastNode && responseText(lastNode) !== baseline.lastText ? lastNode : null;
	}
	function captureAnswerBaseline(root) {
		const nodes = responseNodes(root);
		return {
			nodes,
			lastText: responseText(nodes.at(-1))
		};
	}
	function replaceCumulativeAnswerSnapshot(_previous, current) {
		return current;
	}
	function shouldCompleteAnswer(state) {
		return state.text.trim().length > 0 && !state.stopButtonPresent && (state.explicitCompletionPresent || state.now - state.submittedAt >= 500 && state.now - state.lastChangedAt >= 1e3);
	}
	function abortError() {
		return new DOMException("Answer observation was cancelled.", "AbortError");
	}
	function observeAnswerCompletion(root, baseline, submittedAt, signal, trace, options = {}) {
		return new Promise((resolve, reject) => {
			let settled = false;
			let candidate = null;
			let snapshot = "";
			let lastChangedAt = submittedAt;
			let needsDomRead = true;
			let mutationCount = 0;
			let candidateCount = 0;
			let candidateReported = false;
			let completionReported = false;
			let wasReadable = true;
			const deadlineAt = options.deadlineAt ?? Date.now() + 18e4;
			const report = (checkpoint) => {
				trace?.(checkpoint, {
					mutationCount,
					candidateCount,
					answerLength: snapshot.length
				});
			};
			const finish = (error) => {
				if (settled) return;
				settled = true;
				observer.disconnect();
				window.clearInterval(intervalId);
				window.clearTimeout(timeoutId);
				signal.removeEventListener("abort", onAbort);
				root.removeEventListener("visibilitychange", onVisibility);
				if (error) reject(error);
				else if (candidate) resolve(candidate);
				else reject(/* @__PURE__ */ new Error("Gemini answer completed without a response node."));
			};
			const evaluate = () => {
				if (settled) return;
				if (Date.now() >= deadlineAt) {
					finish(new AnswerObserverError("timed_out", "Gemini answer observation reached its deadline."));
					return;
				}
				if (options.pauseWhenHidden && !(options.isSurfaceVisible?.() ?? root.visibilityState === "visible")) {
					wasReadable = false;
					return;
				}
				if (!wasReadable) {
					wasReadable = true;
					needsDomRead = true;
					lastChangedAt = Date.now();
				}
				if (!needsDomRead && candidate === null) return;
				const blocked = detectGeminiBlockingState(root);
				if (blocked) {
					finish(new AnswerObserverError(blocked.kind === "captcha" ? "manual_intervention" : blocked.kind === "rate_limit" ? "rate_limited" : "manual_intervention", blocked.kind === "captcha" ? `CAPTCHA detected at ${blocked.match.selector}. Automatic operation stopped.` : blocked.kind === "rate_limit" ? `Gemini usage limit detected at ${blocked.match.selector}. Automatic retry is disabled.` : `A Gemini terms, model, or modal confirmation requires manual attention at ${blocked.match.selector}.`));
					return;
				}
				needsDomRead = false;
				const currentNodes = responseNodes(root);
				candidateCount = currentNodes.length;
				const nextCandidate = findCandidate(currentNodes, baseline);
				let candidateFoundNow = false;
				if (nextCandidate) {
					candidate = nextCandidate;
					if (!candidateReported) {
						candidateReported = true;
						candidateFoundNow = true;
					}
				}
				const currentText = responseText(candidate ?? void 0);
				if (currentText !== snapshot) {
					snapshot = replaceCumulativeAnswerSnapshot(snapshot, currentText);
					lastChangedAt = Date.now();
					options.onText?.(snapshot);
				}
				if (candidateFoundNow) report("answer_candidate_found");
				const now = Date.now();
				const explicitCompletionPresent = hasExplicitCompletion(candidate);
				if (explicitCompletionPresent && !completionReported) {
					completionReported = true;
					report("completion_marker_found");
				}
				if (candidate && shouldCompleteAnswer({
					text: snapshot,
					stopButtonPresent: hasVisibleStopButton(root),
					explicitCompletionPresent,
					lastChangedAt,
					submittedAt,
					now
				})) finish();
			};
			const onAbort = () => finish(abortError());
			const onVisibility = () => {
				needsDomRead = true;
				lastChangedAt = Date.now();
				evaluate();
			};
			const observer = new MutationObserver(() => {
				mutationCount += 1;
				report("mutation_received");
				needsDomRead = true;
				evaluate();
			});
			const intervalId = window.setInterval(evaluate, COMPLETION_POLL_MS);
			const timeoutId = window.setTimeout(() => {
				needsDomRead = true;
				evaluate();
				if (!settled) finish(new AnswerObserverError("timed_out", "Gemini answer observation reached the 180 second timeout."));
			}, Math.max(0, deadlineAt - Date.now()));
			if (signal.aborted) {
				finish(abortError());
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			if (options.pauseWhenHidden) root.addEventListener("visibilitychange", onVisibility);
			observer.observe(root.body ?? root.documentElement, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
				attributeFilter: ["aria-busy", "class"]
			});
			candidateCount = options.pauseWhenHidden && !(options.isSurfaceVisible?.() ?? root.visibilityState === "visible") ? 0 : responseNodes(root).length;
			report("observer_installed");
			evaluate();
		});
	}
	//#endregion
	//#region src/userscript/pip.ts
	var PipCompanion = class {
		owner;
		onVisibilityChanged;
		pipWindow = null;
		statusElement = null;
		transcriptElement = null;
		returnButton = null;
		status = "";
		transcript = "";
		opening = false;
		openAttempt = 0;
		constructor(owner, onVisibilityChanged) {
			this.owner = owner;
			this.onVisibilityChanged = onVisibilityChanged;
		}
		get api() {
			return this.owner.documentPictureInPicture;
		}
		get available() {
			return typeof this.api?.requestWindow === "function";
		}
		visible() {
			return this.pipWindow !== null && !this.pipWindow.closed && this.pipWindow.document.visibilityState === "visible";
		}
		async open() {
			if (this.pipWindow && !this.pipWindow.closed) {
				this.pipWindow.focus();
				return;
			}
			const api = this.api;
			if (!api || typeof api.requestWindow !== "function") throw new Error("Document Picture-in-Picture is not available in this browser.");
			if (this.opening) throw new Error("The Gemini companion is already opening.");
			if (api.window && !api.window.closed) throw new Error("Another Picture-in-Picture window is already open. Close it before opening the Gemini companion.");
			this.opening = true;
			const attempt = ++this.openAttempt;
			try {
				const pip = await api.requestWindow({
					width: 360,
					height: 260
				});
				if (attempt !== this.openAttempt) {
					pip.close();
					return;
				}
				this.pipWindow = pip;
				const doc = pip.document;
				doc.documentElement.lang = getLanguage();
				doc.title = "Gemini Search Bridge";
				const style = doc.createElement("style");
				style.textContent = "html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:18px;background:#F2F5FC;color:#243149;font:13px/1.6 system-ui,-apple-system,'Yu Gothic UI',Meiryo,sans-serif}h1{font-size:13px;font-weight:700;letter-spacing:.02em;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #D8E0EF}p{margin:0 0 12px;color:#415FC8;font-weight:650}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:14px 0 0;padding-top:12px;border-top:1px solid #D8E0EF;color:#243149}pre:empty{display:none}button{font:inherit;padding:6px 10px;border:1px solid #D8E0EF;border-radius:7px;background:white;color:#415FC8;cursor:pointer}button:hover{border-color:#415FC8}button:focus-visible{outline:3px solid #415FC8;outline-offset:3px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}";
				doc.head.append(style);
				const heading = doc.createElement("h1");
				heading.textContent = "Gemini Search Bridge";
				this.statusElement = doc.createElement("p");
				this.statusElement.setAttribute("role", "status");
				this.transcriptElement = doc.createElement("pre");
				this.transcriptElement.setAttribute("aria-live", "off");
				const returnButton = this.returnButton = doc.createElement("button");
				returnButton.type = "button";
				returnButton.textContent = translate("Geminiに戻る");
				returnButton.addEventListener("click", () => this.owner.focus());
				doc.body.replaceChildren(heading, this.statusElement, returnButton, this.transcriptElement);
				doc.addEventListener("visibilitychange", () => {
					if (this.pipWindow === pip) this.onVisibilityChanged();
				});
				pip.addEventListener("pagehide", () => this.release(pip));
				this.update(this.status, this.transcript);
				this.onVisibilityChanged();
			} catch (error) {
				this.close();
				throw new Error(`Could not open the Gemini companion: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				this.opening = false;
			}
		}
		release(pip) {
			if (this.pipWindow !== pip) return;
			this.pipWindow = null;
			this.statusElement = null;
			this.transcriptElement = null;
			this.returnButton = null;
			this.onVisibilityChanged();
		}
		close() {
			++this.openAttempt;
			const pip = this.pipWindow;
			if (!pip) return;
			this.release(pip);
			if (!pip.closed) pip.close();
		}
		update(status, text) {
			this.status = status;
			this.transcript = text.slice(0, MAX_ANSWER_TEXT_LENGTH$1);
			this.refreshLanguage();
			if (this.transcriptElement) this.transcriptElement.textContent = this.transcript;
		}
		refreshLanguage() {
			if (this.pipWindow) this.pipWindow.document.documentElement.lang = getLanguage();
			if (this.returnButton) this.returnButton.textContent = translate("Geminiに戻る");
			if (this.statusElement) this.statusElement.textContent = translate(this.status);
		}
	};
	//#endregion
	//#region src/userscript/preferences-view.ts
	var STYLE$1 = `
:host{all:initial;font:14px/1.6 system-ui,-apple-system,"Yu Gothic UI",Meiryo,sans-serif;color:#243149}
*{box-sizing:border-box}[hidden]{display:none!important}
.settings{position:fixed;inset:24px 24px auto auto;z-index:2147483647;width:min(540px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;background:white;border:1px solid #D8E0EF;border-radius:12px;padding:24px;box-shadow:0 12px 40px #24314926}
header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{font-size:20px;line-height:1.3;margin:0}p{margin:12px 0;color:#5D6C85}
label{display:block;margin-top:20px;font-weight:600}.default{display:flex;gap:10px;align-items:start;font-weight:400}input{margin:5px 0 0;accent-color:#415FC8}
select,textarea,button{font:inherit}select,textarea{display:block;width:100%;margin-top:8px;border:1px solid #A9B7D0;border-radius:6px;padding:9px;color:#243149;background:white}
textarea{min-height:140px;resize:vertical;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,Consolas,monospace;caret-color:#415FC8}textarea:disabled{background:#F2F5FC;color:#5D6C85}
button{cursor:pointer;min-height:40px;padding:8px 14px;border:1px solid #D8E0EF;border-radius:6px;background:white;color:#415FC8}.save{background:#415FC8;border-color:#415FC8;color:white}button:hover{filter:brightness(.94)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #415FC8;outline-offset:3px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.error{color:#A32B31}.message{margin-bottom:0}code{color:#243149}::selection{background:#D8E0EF;color:#243149}
@media(max-width:480px){.settings{inset:12px 12px auto auto;width:calc(100vw - 24px);max-height:calc(100vh - 24px);padding:18px}}
`;
	var current;
	function focusedElement() {
		let focused = document.activeElement;
		while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
		return focused;
	}
	/** A nonmodal, script-owned region: it never changes Gemini's application DOM. */
	var PreferencesView = class {
		host = document.createElement("div");
		panel = document.createElement("section");
		language = document.createElement("select");
		useDefault = document.createElement("input");
		template = document.createElement("textarea");
		message = document.createElement("p");
		labels = [];
		customDraft = null;
		messageText = "";
		previousFocus = focusedElement();
		refresh = () => {
			this.panel.lang = getLanguage();
			for (const update of this.labels) update();
			this.updateTemplate();
			this.message.textContent = this.messageText === "保存しました。次の検索から適用されます。" ? localized(this.messageText, "Saved. Changes apply to future searches.") : translate(this.messageText);
		};
		constructor() {
			this.host.id = "gemini-search-bridge-preferences";
			const root = this.host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = STYLE$1;
			this.panel.className = "settings";
			this.panel.setAttribute("role", "region");
			this.panel.setAttribute("aria-labelledby", "gsb-settings-title");
			const heading = this.text("h2", "ユーザースクリプト設定", "Userscript settings");
			heading.id = "gsb-settings-title";
			const close = this.text("button", "閉じる", "Close");
			close.type = "button";
			close.addEventListener("click", () => this.close());
			const header = document.createElement("header");
			header.append(heading, close);
			const intro = this.text("p", "変更は次の検索から適用されます。現在の検索は再送信しません。", "Changes apply to future searches. This does not resend your current search.");
			const form = document.createElement("form");
			form.noValidate = true;
			const languageLabel = this.text("label", "表示言語", "Display language");
			this.language.id = "gsb-language";
			languageLabel.htmlFor = this.language.id;
			for (const [value, ja, en] of [
				[
					"auto",
					"ブラウザーに合わせる",
					"Follow browser language"
				],
				[
					"ja",
					"日本語",
					"日本語"
				],
				[
					"en",
					"English",
					"English"
				]
			]) {
				const option = this.text("option", ja, en);
				option.value = value;
				this.language.append(option);
			}
			this.language.addEventListener("change", () => this.updateTemplate());
			const defaultLabel = document.createElement("label");
			defaultLabel.className = "default";
			this.useDefault.type = "checkbox";
			defaultLabel.append(this.useDefault, this.text("span", "言語に合わせた既定のプロンプトを使う", "Use the default prompt for the selected language"));
			const templateLabel = this.text("label", "プロンプトテンプレート", "Prompt template");
			this.template.id = "gsb-template";
			templateLabel.htmlFor = this.template.id;
			this.template.maxLength = 4096;
			this.template.setAttribute("aria-describedby", "gsb-template-help gsb-settings-message");
			this.template.addEventListener("input", () => {
				this.customDraft = this.template.value;
			});
			this.useDefault.addEventListener("change", () => {
				if (this.useDefault.checked || this.customDraft === null) this.customDraft = this.template.value;
				this.updateTemplate();
			});
			const help = this.text("p", "%%prompt%% を検索語に置き換えます。例: ウェブ検索し参照を明示: %%prompt%%", "%%prompt%% is replaced with the search query. Example: Search the web and cite your sources: %%prompt%%");
			help.id = "gsb-template-help";
			const save = this.text("button", "保存", "Save");
			save.type = "submit";
			save.className = "save";
			const reset = this.text("button", "既定に戻す", "Reset to defaults");
			reset.type = "button";
			reset.addEventListener("click", () => {
				this.language.value = "auto";
				this.useDefault.checked = true;
				this.customDraft = null;
				this.updateTemplate();
				this.messageText = "";
				this.message.textContent = "";
				this.template.setAttribute("aria-invalid", "false");
			});
			const actions = document.createElement("div");
			actions.className = "actions";
			actions.append(save, reset);
			this.message.id = "gsb-settings-message";
			this.message.className = "message";
			this.message.setAttribute("role", "status");
			this.message.setAttribute("aria-live", "polite");
			form.addEventListener("submit", (event) => {
				event.preventDefault();
				try {
					savePreferences({
						language: this.language.value,
						promptTemplate: this.useDefault.checked ? null : this.template.value
					});
					this.messageText = "保存しました。次の検索から適用されます。";
					this.message.className = "message";
					this.template.setAttribute("aria-invalid", "false");
					window.dispatchEvent(new Event("gsb-preferences-changed"));
					this.refresh();
				} catch (error) {
					this.messageText = error instanceof Error ? error.message : String(error);
					this.message.className = "message error";
					this.template.setAttribute("aria-invalid", "true");
					this.message.textContent = translate(this.messageText);
					this.template.focus();
				}
			});
			form.append(languageLabel, this.language, defaultLabel, templateLabel, this.template, help, actions, this.message);
			this.panel.append(header, intro, form);
			root.append(style, this.panel);
			document.body.append(this.host);
			const preferences = readPreferences();
			this.language.value = preferences.language;
			this.useDefault.checked = preferences.promptTemplate === null;
			this.customDraft = preferences.promptTemplate;
			window.addEventListener("gsb-preferences-changed", this.refresh);
			this.panel.addEventListener("keydown", (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					this.close();
				}
			});
			this.refresh();
			this.language.focus();
		}
		text(tag, ja, en) {
			const node = document.createElement(tag);
			this.labels.push(() => {
				node.textContent = localized(ja, en);
			});
			return node;
		}
		updateTemplate() {
			const language = resolveLanguage(this.language.value, navigator.language);
			this.template.disabled = this.useDefault.checked;
			if (this.useDefault.checked) this.template.value = DEFAULT_TEMPLATES[language];
			else if (this.customDraft !== null && this.template.value !== this.customDraft) this.template.value = this.customDraft;
			this.template.placeholder = DEFAULT_TEMPLATES[language];
		}
		focus() {
			this.language.focus();
		}
		close() {
			window.removeEventListener("gsb-preferences-changed", this.refresh);
			this.host.remove();
			current = void 0;
			if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) this.previousFocus.focus();
		}
	};
	function openPreferences() {
		if (current?.host.isConnected) {
			current.focus();
			return;
		}
		current = new PreferencesView();
	}
	//#endregion
	//#region src/userscript/worker-view.ts
	var STYLE = `
:host{all:initial;font-family:system-ui,-apple-system,"Yu Gothic UI",Meiryo,sans-serif;color:#243149;line-height:1.65}
*{box-sizing:border-box}[hidden]{display:none!important}
button{font:inherit;cursor:pointer;touch-action:manipulation}
button:focus-visible{outline:3px solid #415FC8;outline-offset:5px}
.screen{position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#F2F5FC;padding:clamp(24px,5vw,64px)}
.shell{max-width:1080px;min-height:100%;margin:0 auto;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:650;letter-spacing:.04em}
.mark{width:30px;height:30px;object-fit:contain}
.layout{flex:1;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,1fr);gap:clamp(30px,7vw,90px);align-items:center;padding:clamp(32px,8vh,80px) 0}
h1{max-width:15em;margin:0 0 24px;font-size:clamp(32px,4.5vw,56px);line-height:1.3;font-weight:750;letter-spacing:-.03em;text-wrap:balance}
.intro{max-width:34em;margin:0 0 24px;font-size:16px}
.primary{width:100%;max-width:420px;min-height:56px;padding:14px 22px;background:#415FC8;border:1px solid #415FC8;border-radius:12px;color:white;font-size:15px;font-weight:700;box-shadow:0 6px 18px #415FC81a;transition:background .15s ease}
.primary:hover:not(:disabled){background:#334DAF}.primary:disabled{cursor:default;background:#D8E0EF;border-color:#D8E0EF;color:#46556E;box-shadow:none}
.paused{margin:12px 0 0;color:#5D6C85;font-size:13px}
.status{margin:18px 0 0;overflow-wrap:anywhere;font-size:14px}
.ready{margin:18px 0 0;padding:16px;background:white;border:1px solid #D8E0EF;border-radius:12px;font-size:14px}
.return{margin:12px 0 0;color:#5D6C85;font-size:14px}
.side{padding:0;min-width:0}
.signal{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:650}
.dot{width:7px;height:7px;border-radius:50%;background:#7A8AA8}.side[data-ready="true"] .dot{background:#287C75}
.steps{margin:0;padding:0;list-style:none}.steps li{display:flex;gap:12px;font-size:14px;align-items:flex-start}.steps li+li{margin-top:20px}
.step{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#F2F5FC;color:#415FC8;font-size:12px;font-weight:700}
.steps strong{display:block;font-weight:650}.steps span:last-child{color:#5D6C85;font-size:12px}
.step-copy{min-width:0;flex:1}.steps .step{background:white;border:1px solid #D8E0EF}.flow-note{display:block;margin:5px 0 10px}
.mini{overflow:hidden;background:white;border:1px solid #D8E0EF;border-radius:8px;min-width:0}.mini-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#E8EEFA;border-bottom:1px solid #D8E0EF;color:#46556E;font-size:11px}.mini-head img{width:15px;height:15px;vertical-align:middle;margin-inline-end:5px}.mini-body{padding:12px;color:#5D6C85;font-size:12px}
.mini-button{display:inline-block;padding:4px 9px;border-radius:4px;background:#415FC8;color:white;font-weight:600}.mini-answer{padding-top:8px;color:#243149}.mini-search{border:1px solid #D8E0EF;border-radius:20px;padding:5px 10px;color:#5D6C85}.window-controls{display:flex;gap:12px;flex:none}.window-controls i{display:block;position:relative;width:10px;height:10px}.minimize::after{content:"";position:absolute;left:0;right:0;bottom:2px;border-bottom:1px solid currentColor}.window-close::before,.window-close::after{content:"";position:absolute;left:4px;top:0;height:11px;border-left:1px solid currentColor;transform:rotate(45deg)}.window-close::after{transform:rotate(-45deg)}
.policy{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.policy div{font-size:12px;line-height:1.5}.policy b{display:block;font-size:13px}.policy-ok{color:#216C62}.policy-no{color:#A32B31}.policy-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid currentColor;border-radius:5px;margin-bottom:5px}.policy-icon i{position:relative;width:11px;height:11px}.mini-caption{padding:0 12px 12px;color:#415FC8;font-size:11px}.mini-pip{border-color:#415FC8}.mini-pip .mini-head{background:#E8EEFA}.pip-caption{font-weight:600}
.consent{max-width:42em;margin:0 0 20px;color:#5D6C85;font-size:12px}
.footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding-top:20px}
.plain{padding:8px 0;border:0;background:transparent;color:#415FC8;font-size:13px;text-decoration:underline;text-underline-offset:4px}.plain:hover{color:#243149}
.close{color:#5D6C85}.pill{position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:11px 16px;background:white;border:1px solid #D8E0EF;border-radius:999px;box-shadow:0 4px 20px #24314918;color:#243149;font-size:13px;font-weight:650}.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:#415FC8}
@media(max-width:760px){.layout{grid-template-columns:1fr;gap:28px}.screen{padding:24px}.layout{padding:38px 0 28px}.primary{max-width:none}h1{font-size:clamp(30px,7.5vw,44px)}}
@media(max-height:600px) and (min-width:761px){.layout{padding:28px 0}.screen{padding:24px 40px}h1{font-size:36px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
	var WorkerView = class {
		labels = [];
		host = document.createElement("div");
		screen = document.createElement("section");
		openButton = document.createElement("button");
		closeButton = document.createElement("button");
		inspectButton = document.createElement("button");
		pill = document.createElement("button");
		status = document.createElement("p");
		ready = document.createElement("p");
		paused = document.createElement("p");
		side = document.createElement("aside");
		signal = document.createElement("span");
		constructor(actions) {
			this.host.id = "gemini-search-bridge-worker-view";
			const root = this.host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = STYLE;
			this.screen.className = "screen";
			this.screen.setAttribute("role", "region");
			this.screen.setAttribute("aria-labelledby", "gsb-worker-heading");
			const shell = this.element("div", "shell");
			const brand = this.element("div", "brand");
			const mark = this.element("img", "mark");
			mark.setAttribute("referrerpolicy", "no-referrer");
			mark.src = GEMINI_ICON;
			mark.alt = "";
			mark.setAttribute("aria-hidden", "true");
			brand.append(mark, this.element("span", "", "Gemini Search Bridge"));
			const layout = this.element("div", "layout");
			const main = this.element("div", "content");
			const heading = this.element("h1", "", "小窓を開いて、検索に戻る。");
			heading.id = "gsb-worker-heading";
			const intro = this.element("p", "intro", "Geminiの回答をGoogle検索に表示します。最初に、この画面からPiP小窓を開いてください。");
			const consent = this.element("p", "consent", "ボタンを押すと、Google検索の検索語をGeminiへ自動送信することに同意します。送信には、ログイン中のGoogleアカウントのGemini画面を使います。会話はGeminiの履歴設定に従って保存され、ご利用プランの制限が適用されます。APIキーは不要です。");
			this.openButton.type = "button";
			this.openButton.className = "primary";
			this.openButton.addEventListener("click", () => actions.onOpenPip());
			this.paused.className = "paused";
			this.status.className = "status";
			this.status.setAttribute("role", "status");
			this.status.setAttribute("aria-live", "polite");
			this.ready.className = "ready";
			this.ready.textContent = "PiP小窓が表示されている間は、このウィンドウを最小化できます。閉じないでください。";
			const returnSearch = this.element("p", "return", "小窓を開いたら、Google検索のタブに戻って検索してください。回答は検索カードに表示されます。");
			main.append(heading, intro, consent, this.openButton, this.paused, this.status, this.ready, returnSearch);
			this.side.className = "side";
			const steps = this.element("ol", "steps");
			for (const [index, [title, english, note, englishNote]] of [
				[
					"PiP小窓を開く",
					"Open the PiP companion",
					"この画面のボタンを直接押します。",
					"Click the button on this page."
				],
				[
					"小窓は表示したまま",
					"Keep the companion visible",
					"常に手前に表示される小窓が、回答を取得し続けます。",
					"The always-on-top companion keeps answer capture running."
				],
				[
					"Google検索に戻る",
					"Return to Google Search",
					"検索すると、回答が検索カードに届きます。",
					"Search as usual. Gemini answers appear in the search card."
				]
			].entries()) {
				const row = document.createElement("li");
				const copy = this.element("div", "step-copy");
				copy.append(this.element("strong", "", title, english), this.element("span", "flow-note", note, englishNote));
				const mini = this.element("div", index === 1 ? "mini mini-pip" : "mini");
				mini.setAttribute("aria-hidden", "true");
				const miniHead = this.element("div", "mini-head");
				const miniTitle = this.element("span", "", index === 2 ? "Google Search" : index === 1 ? "PiP · Gemini" : "Gemini");
				const controls = this.element("span", "window-controls");
				controls.append(this.element("i", "minimize"), this.element("i", "window-close"));
				miniHead.append(miniTitle, controls);
				const miniBody = this.element("div", "mini-body");
				if (index === 0) {
					miniBody.append(this.element("span", "mini-button", "PiP小窓を開く", "Open PiP"));
					const policy = this.element("div", "policy");
					for (const [css, symbol, ja, en] of [[
						"policy-ok",
						"minimize",
						"最小化 OK",
						"Minimize: OK"
					], [
						"policy-no",
						"window-close",
						"閉じる NG",
						"Close: No"
					]]) {
						const item = this.element("div", css);
						const icon = this.element("span", "policy-icon");
						icon.append(this.element("i", symbol));
						icon.setAttribute("aria-hidden", "true");
						item.append(icon, this.element("b", "", ja, en));
						policy.append(item);
					}
					miniBody.append(policy);
				} else if (index === 1) {
					const signalRow = this.element("p", "signal");
					signalRow.append(this.element("span", "dot"), this.signal);
					miniBody.append(signalRow, this.element("p", "mini-answer", "回答を取得 → 検索カードへ", "Capture answer → search card"));
				} else miniBody.append(this.element("div", "mini-search", "検索語を入力", "Enter a search query"), this.element("div", "mini-answer", "Geminiの回答", "Gemini answer"));
				mini.append(miniHead, miniBody);
				if (index === 0) mini.append(this.element("div", "mini-caption", "PiPが表示中のときだけ最小化できます。", "Minimize only while PiP is visible."));
				if (index === 1) mini.append(this.element("div", "mini-caption pip-caption", "この小窓は閉じずに、画面のすみへ。", "Keep this companion open in a screen corner."));
				copy.append(mini);
				row.append(this.element("span", "step", String(index + 1)), copy);
				steps.append(row);
			}
			this.side.append(steps);
			layout.append(main, this.side);
			const footer = this.element("div", "footer");
			this.inspectButton.type = "button";
			this.inspectButton.className = "plain inspect";
			this.bind(this.inspectButton, "Gemini画面を確認");
			this.inspectButton.addEventListener("click", () => {
				actions.onInspect?.();
				this.revealGemini();
			});
			this.closeButton.type = "button";
			this.closeButton.className = "plain close";
			this.bind(this.closeButton, "PiPを閉じて自動送信を停止");
			this.closeButton.addEventListener("click", () => actions.onClosePip());
			const settings = this.element("button", "plain preferences", "言語・プロンプト設定", "Language and prompt settings");
			settings.type = "button";
			settings.addEventListener("click", openPreferences);
			footer.append(this.inspectButton, settings, this.closeButton);
			shell.append(brand, layout, footer);
			this.screen.append(shell);
			this.screen.addEventListener("keydown", (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					actions.onInspect?.();
					this.revealGemini();
				}
			});
			this.pill.type = "button";
			this.pill.className = "pill";
			this.bind(this.pill, "小窓の設定を開く");
			this.pill.hidden = true;
			this.pill.addEventListener("click", () => {
				this.screen.hidden = false;
				this.pill.hidden = true;
				(this.openButton.disabled ? this.inspectButton : this.openButton).focus();
			});
			root.append(style, this.screen, this.pill);
			document.body.append(this.host);
			this.update({
				pipReady: false,
				supported: false
			});
		}
		bind(element, text, english) {
			const update = () => {
				element.textContent = english === void 0 ? translate(text) : localized(text, english);
			};
			this.labels.push(update);
			update();
		}
		element(tag, className, text, english) {
			const element = document.createElement(tag);
			element.className = className;
			if (text !== void 0) this.bind(element, text, english);
			return element;
		}
		update(state) {
			this.screen.lang = getLanguage();
			for (const update of this.labels) update();
			this.ready.textContent = translate("PiP小窓が表示されている間は、このウィンドウを最小化できます。閉じないでください。");
			this.openButton.disabled = !state.supported || state.pipReady;
			this.openButton.textContent = translate(state.pipReady ? "PiP小窓は表示中です" : "PiPを開いて自動送信を開始");
			this.closeButton.hidden = !state.pipReady;
			this.ready.hidden = !state.pipReady;
			this.paused.hidden = state.pipReady;
			this.paused.textContent = translate(state.supported ? "PiP小窓を開くまで、自動送信は停止しています。" : "このブラウザーではPiPを利用できないため、自動送信は停止しています。Chromeで開いてください。");
			this.side.dataset.ready = String(state.pipReady);
			this.signal.textContent = translate(state.pipReady ? "小窓を表示しています" : "小窓の開始を待っています");
			this.status.textContent = translate(state.status ?? "");
			this.status.hidden = !state.status;
		}
		revealGemini() {
			this.screen.hidden = true;
			this.pill.hidden = false;
			this.pill.focus();
		}
	};
	//#endregion
	//#region src/userscript/conversation-guard.ts
	/** A native user turn must match this job before its route can be attributed. */
	function submittedQueryMatches(root, query) {
		const turns = Array.from(root.querySelectorAll("user-query"));
		if (turns.length !== 1) return false;
		const turn = turns[0];
		const normalize = (value) => value.replace(/\r\n?/g, "\n").trim();
		const readText = (element) => element.innerText ?? element.textContent ?? "";
		const lines = Array.from(turn.querySelectorAll(".query-text-line"));
		return normalize(lines.length ? lines.map((line) => normalize(readText(line))).join("\n") : readText(turn.querySelector(".query-text, .query-content") ?? turn)) === normalize(query);
	}
	//#endregion
	//#region src/userscript/worker.ts
	async function startGemini(tab, workerId) {
		const existing = liveWorker(GM_getValue(WORKER_KEY, null));
		if (existing && existing.id !== workerId) return;
		tab.gsbWorkerId = workerId;
		GM_saveTab(tab);
		await documentReady();
		const adapter = new Phase2GeminiAdapter();
		let controller = null;
		let active = null;
		let progressText = "";
		let status = "PiPを開くと、この検索と次の検索を自動送信します。";
		let routeChanged = false;
		let routeTimer;
		let newChatReady = false;
		let lastFocusNonce = tab.gsbFocusNonce;
		const pip = new PipCompanion(window, surfaceChanged);
		const view = new WorkerView({
			onOpenPip() {
				pip.open().then(() => {
					acceptConsent();
					status = "検索画面に戻って、そのまま検索を続けられます。";
					surfaceChanged();
				}).catch(() => {
					status = "PiPを開けませんでした。Chromeでこのボタンを直接押してください。";
					updateView();
				});
			},
			onClosePip() {
				pip.close();
			},
			onInspect() {
				if (active) {
					routeChanged = true;
					controller?.abort();
				}
			}
		});
		function updateView() {
			view.update({
				pipReady: pip.visible(),
				supported: pip.available,
				status
			});
		}
		function heartbeat() {
			const owner = liveWorker(GM_getValue(WORKER_KEY, null));
			if (owner && owner.id !== workerId) {
				controller?.abort();
				return;
			}
			GM_setValue(WORKER_KEY, {
				id: workerId,
				seenAt: Date.now(),
				visible: document.visibilityState === "visible",
				busy: controller !== null,
				pipReady: pip.visible() && consentAccepted(),
				protocolVersion: 5,
				...active ? { activeJobId: active.job.id } : {}
			});
			const reply = GM_getValue(REPLY_KEY, null);
			if (isUserscriptReply(reply) && Date.now() - reply.updatedAt > 3e5) GM_deleteValue(REPLY_KEY);
			pruneReceipts();
			const request = GM_getValue(REQUEST_KEY, null);
			if (isUserscriptRequest(request) && !pendingRequest(request) && !active) GM_deleteValue(REQUEST_KEY);
		}
		function visibilityDetail() {
			return pip.visible() ? void 0 : "PiPが閉じているため取得を待機中です。Gemini側で小窓を開くと再開します。再送信はしません。";
		}
		function publish(request, phase, detail, answer) {
			if (phase === "generating" && Date.now() >= request.job.createdAt + 3e5) return;
			const currentUrl = readConversationUrl();
			const conversationUrl = (phase === "generating" || phase === "completed") && currentUrl === tab.gsbRunConversationUrl ? currentUrl : null;
			const reply = {
				jobId: request.job.id,
				sourceTabId: request.job.sourceTabId,
				status: phase,
				updatedAt: Date.now(),
				...detail ? { detail: detail.slice(0, 500) } : {},
				...answer ? { answer } : {},
				...phase === "generating" ? { progressText: progressText.slice(0, MAX_ANSWER_TEXT_LENGTH$1) } : {},
				...conversationUrl ? { conversationUrl } : {}
			};
			writeReceipt(request.job, reply);
			GM_setValue(REPLY_KEY, reply);
		}
		function readConversationUrl() {
			const url = new URL(location.href);
			return sanitizeConversationUrl(`${url.origin}${url.pathname}`);
		}
		async function pinConversation(signal, query) {
			const deadline = Date.now() + 8e3;
			while (!signal.aborted && Date.now() < deadline) {
				const url = readConversationUrl();
				if (url && url !== tab.gsbPreviousConversationUrl && submittedQueryMatches(document, query)) {
					tab.gsbRunConversationUrl = url;
					GM_saveTab(tab);
					return;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 100));
			}
			throw new GeminiAdapterError("manual_intervention", "この検索の会話URLを確認できません。Geminiで既存のチャットを確認してください。自動再送信はしません。");
		}
		function surfaceChanged() {
			if (active && tab.gsbRunPhase === "generating") publish(active, "generating", visibilityDetail());
			else if (controller && tab.gsbRunPhase !== "submitting" && !pip.visible()) controller.abort();
			heartbeat();
			updateView();
			if (pip.visible()) processRequest();
		}
		async function processRequest() {
			const request = pendingRequest(GM_getValue(REQUEST_KEY, null));
			if (controller || !request || request.workerId !== workerId || !consentAccepted() || !pip.visible() || liveWorker(GM_getValue("gsb-userscript:v4:worker", null))?.id !== workerId) return;
			const receipt = readReceipt(request.job);
			const resume = tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating";
			if (receipt && !resume) {
				if (receipt.reply && receipt.reply.status !== "generating" && receipt.reply.status !== "loading_gemini" && receipt.reply.status !== "starting_new_chat" && receipt.reply.status !== "filling_prompt" && receipt.reply.status !== "submitting") GM_setValue(REPLY_KEY, receipt.reply);
				else publish(request, "manual_intervention", "受理済みの検索です。Geminiで送信状況を確認してください。自動再送信はしません。");
				GM_deleteValue(REQUEST_KEY);
				return;
			}
			controller = new AbortController();
			active = request;
			routeChanged = false;
			newChatReady = false;
			const signal = controller.signal;
			writeReceipt(request.job);
			const previous = GM_getValue(REPLY_KEY, null);
			progressText = isUserscriptReply(previous) && previous.jobId === request.job.id ? previous.progressText ?? "" : "";
			heartbeat();
			routeTimer = window.setInterval(() => {
				if (tab.gsbRunConversationUrl) {
					if (readConversationUrl() !== tab.gsbRunConversationUrl) {
						routeChanged = true;
						controller?.abort();
					}
				} else if (newChatReady && tab.gsbRunPhase === "preparing" && !/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname)) {
					routeChanged = true;
					controller?.abort();
				}
			}, 100);
			try {
				if (tab.gsbRunId === request.job.id && tab.gsbRunPhase === "submitting") throw new GeminiAdapterError("manual_intervention", "送信中にページが切り替わりました。Geminiで送信状況を確認してください。自動再送信はしません。");
				let baseline = {
					nodes: [],
					lastText: ""
				};
				let submittedAt = typeof tab.gsbSubmittedAt === "number" ? tab.gsbSubmittedAt : Date.now();
				if (!(tab.gsbRunId === request.job.id && tab.gsbRunPhase === "generating")) {
					tab.gsbPreviousConversationUrl = readConversationUrl();
					tab.gsbRunConversationUrl = null;
					tab.gsbRunId = request.job.id;
					tab.gsbRunPhase = "preparing";
					GM_saveTab(tab);
					publish(request, "loading_gemini");
					await adapter.waitUntilReady(signal);
					if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail());
					publish(request, "starting_new_chat");
					await adapter.startNewChat(signal);
					newChatReady = true;
					if (!/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname)) throw new GeminiAdapterError("manual_intervention", "新規チャットの準備を確認できませんでした。");
					if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail());
					publish(request, "filling_prompt");
					await adapter.fillPrompt(request.job.promptText, signal);
					if (!/^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname) || routeChanged) throw new GeminiAdapterError("manual_intervention", "準備中に会話が変わりました。送信を停止しました。");
					if (!pip.visible()) throw new GeminiAdapterError("manual_intervention", visibilityDetail());
					baseline = captureAnswerBaseline(document);
					tab.gsbRunPhase = "submitting";
					GM_saveTab(tab);
					publish(request, "submitting");
					await adapter.submit(signal);
					submittedAt = Date.now();
					tab.gsbSubmittedAt = submittedAt;
					tab.gsbRunPhase = "generating";
					GM_saveTab(tab);
					await pinConversation(signal, request.job.promptText);
				}
				if (!tab.gsbRunConversationUrl || readConversationUrl() !== tab.gsbRunConversationUrl || !submittedQueryMatches(document, request.job.promptText) || routeChanged) throw new GeminiAdapterError("manual_intervention", "生成中の会話が変わりました。取り違えを防ぐため取得を停止しました。自動再送信はしません。");
				publish(request, "generating");
				status = "生成中です。PiP小窓を表示したまま検索に戻れます。";
				updateView();
				let lastProgressAt = 0;
				const root = await observeAnswerCompletion(document, baseline, submittedAt, signal, void 0, {
					pauseWhenHidden: true,
					deadlineAt: request.job.createdAt + MAX_JOB_AGE_MS,
					isSurfaceVisible: () => pip.visible(),
					onText(snapshot) {
						if (readConversationUrl() !== tab.gsbRunConversationUrl) {
							routeChanged = true;
							controller?.abort();
							return;
						}
						progressText = snapshot.slice(0, MAX_ANSWER_TEXT_LENGTH$1);
						pip.update("生成中…", progressText);
						if (Date.now() - lastProgressAt < 250) return;
						lastProgressAt = Date.now();
						publish(request, "generating", visibilityDetail());
					}
				});
				if (readConversationUrl() !== tab.gsbRunConversationUrl) throw new GeminiAdapterError("manual_intervention", "会話が変わったため回答取得を停止しました。");
				const answer = extractStructuredAnswer(root, {
					jobId: request.job.id,
					sourceTabId: request.job.sourceTabId,
					completedAt: Date.now()
				});
				publish(request, "completed", void 0, answer);
				pip.update("回答が完了しました", answer.plainText);
				status = "回答を検索画面に表示しました。次の検索も自動送信します。";
			} catch (error) {
				const code = tab.gsbRunPhase === "submitting" || routeChanged ? "manual_intervention" : error instanceof GeminiAdapterError || error instanceof AnswerObserverError ? error.code : "failed";
				publish(request, !pip.visible() && code === "failed" ? "manual_intervention" : code, routeChanged ? "生成中の会話が変わりました。取り違えを防ぐため取得を停止しました。自動再送信はしません。" : tab.gsbRunPhase === "submitting" ? "送信を確認できません。既存のチャットを確認してください。自動再送信はしません。" : visibilityDetail() ?? (error instanceof Error ? error.message : "Geminiの操作に失敗しました。"));
				status = "Geminiで必要な操作を確認してください。自動再送信はしません。";
				pip.update(status, progressText);
				view.revealGemini();
			} finally {
				window.clearInterval(routeTimer);
				tab.gsbRunPhase = "settled";
				GM_saveTab(tab);
				const current = GM_getValue(REQUEST_KEY, null);
				if (isUserscriptRequest(current) && current.job.id === request.job.id) GM_deleteValue(REQUEST_KEY);
				controller = null;
				active = null;
				heartbeat();
				updateView();
			}
		}
		function focusRequested(value) {
			if (!isFocusRequest(value) || value.workerId !== workerId || value.nonce === lastFocusNonce || storedWorker(GM_getValue("gsb-userscript:v4:worker", null))?.id !== workerId) return;
			lastFocusNonce = value.nonce;
			tab.gsbFocusNonce = value.nonce;
			GM_saveTab(tab);
			try {
				window.focus();
			} catch {}
			window.setTimeout(() => {
				if (!isFocusRequest(value)) return;
				heartbeat();
				GM_setValue(FOCUS_ACK_KEY, {
					...value,
					checkedAt: Date.now(),
					visible: document.visibilityState === "visible",
					hasFocus: document.hasFocus()
				});
			}, 500);
		}
		document.addEventListener("visibilitychange", surfaceChanged);
		window.addEventListener("popstate", () => {
			if (active) {
				routeChanged = true;
				controller?.abort();
			}
		});
		GM_addValueChangeListener(REQUEST_KEY, () => {
			if (!active) processRequest();
		});
		GM_addValueChangeListener(FOCUS_KEY, (_key, _old, value) => focusRequested(value));
		function preferencesChanged() {
			pip.refreshLanguage();
			updateView();
		}
		GM_addValueChangeListener(PREFERENCES_KEY, preferencesChanged);
		window.addEventListener("gsb-preferences-changed", preferencesChanged);
		heartbeat();
		updateView();
		focusRequested(GM_getValue(FOCUS_KEY, null));
		window.setInterval(() => {
			heartbeat();
			processRequest();
		}, 3e3);
	}
	//#endregion
	//#region src/userscript/main.ts
	var marker = /^#gsb-worker=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
	if (window.top === window) {
		if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand(localized("Gemini Search Bridge 設定", "Gemini Search Bridge settings"), openPreferences);
		GM_getTab((tab) => {
			const workerId = isWorkerId(marker) ? marker : tab.gsbWorkerId;
			if (location.hostname === "gemini.google.com" && isWorkerId(workerId)) startGemini(tab, workerId);
			else if (readGoogleQuery()) startGoogle(tab);
		});
	}
	//#endregion
})();
