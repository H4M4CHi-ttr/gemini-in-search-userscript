# Gemini in Search — userscript

[日本語](README.jp.md)

See streaming Gemini answers inside Google Search. This Tampermonkey userscript,
named **Gemini Search Bridge** in the extension menu, operates your signed-in Gemini
Web UI. It does not use an API key or a developer backend.

Keep its always-on-top Picture-in-Picture (PiP) companion visible. While PiP is open,
you may **minimize the Gemini owner window, but do not close it**. Closing the owner
also closes PiP and stops capture.

## Install in desktop Chrome

1. Install [Tampermonkey for Chrome](https://www.tampermonkey.net/index.php?browser=chrome). Use version 5.5 or later.
2. Open Tampermonkey's Chrome extension details and enable **Allow User Scripts**. Follow the [official permission guide](https://www.tampermonkey.net/faq.php?locale=en&q=Q209#google_vignette) if the setting is hard to find.
3. [Install this userscript](https://raw.githubusercontent.com/H4M4CHi-ttr/gemini-in-search-userscript/main/dist/gemini-in-search.user.js) and confirm the installation in Tampermonkey.
4. Sign in to [Gemini](https://gemini.google.com/app), then reload your Google Search tab.

Update the existing script rather than keeping two copies enabled. Its name and
namespace remain unchanged for existing installations. A Greasy Fork link will be
added after publication there.

## Start once, then keep searching

Click **Open Gemini window** in the search card. Read the notice in that window and
click **Open PiP and start automatic sending** directly. Return to Google Search;
this search and subsequent searches are sent automatically while PiP stays visible.

Place PiP in a corner. Keep it visible, and keep the Gemini owner open. The owner
may be minimized only while PiP is visible; do not minimize or close PiP itself.
If capture pauses, restore the owner and reopen PiP.

Long answers start as a compact preview. **Show more** reveals the full answer,
followed by **Continue this conversation in Gemini** and **Show less**. Short answers
show the conversation action without an expansion button. The owner-opening button
is a small bottom-right action once PiP is ready.

Login, CAPTCHA, account limits, terms and model selection require your own action
in Gemini. The script does not bypass these controls. Failed searches are not
automatically resent; use **Send this search again** only after checking the existing chat.

## Choose a language or customize the prompt

Open **Gemini Search Bridge settings** from Tampermonkey's menu, or **Language and
prompt settings** in the Gemini preparation screen. Choose Follow browser language,
日本語 or English. Automatic mode selects Japanese for a Japanese browser language
and English otherwise. This changes the script's UI, not Gemini's answer text.

The language-aware defaults are:

```text
Japanese: ウェブ検索し参照を明示: %%prompt%%
English:  Search the web and cite your sources: %%prompt%%
```

Uncheck the default-template option to write your own template. Include
`%%prompt%%`; every occurrence is replaced literally with the search query. For example:

```text
Give a concise answer with sources for: %%prompt%%
```

Save to apply changes to future searches. Already queued or submitted work keeps
its prepared text. Templates are limited to 4,096 characters and expanded prompts
to 16,384; oversized prompts are rejected rather than shortened.

### Updating from v0.4.x

After installing v0.5, reload both Google Search and the existing Gemini owner,
then click its PiP-start button again. Interrupted old searches are not replayed
under the new template. Completed cached answers remain eligible for restoration.

## Privacy and limitations

Queries and answers are temporarily stored in Tampermonkey's local storage for
cross-tab delivery. Language and template preferences stay there until changed.
Deduplication and prepared-job references remain in per-tab state. Prompts are sent
to your Gemini account and may appear in its history; Gemini's usual limits apply.

The integration is unofficial and depends on Gemini's DOM and Chrome's rendering.
It does not read cookies directly, call private RPCs or Gemini APIs, or use
Offscreen, iframes or DNR.
Unknown Google AI containers may remain visible to avoid hiding ordinary results.
The icon loads from Google's favicon service without a referrer; this does not
send search or conversation text in the icon request.
Multiline template indentation may not match Gemini's normalized displayed text.
If verification stops, inspect the existing chat instead of resending blindly.
PiP does not guarantee uninterrupted capture under every OS or browser condition.

## Build and test

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Vite bundles TypeScript into a readable IIFE without minification. The public
installer is `dist/gemini-in-search.user.js`; the same bundle is also written to
`outputs/userscript/gemini-search-bridge.user.js` for local installation. See
[the design](docs/DESIGN.md) for implementation boundaries.

[Report a problem](https://github.com/H4M4CHi-ttr/gemini-in-search-userscript/issues).
Project code is [MIT licensed](LICENSE). Google branding is covered separately in
[third-party notices](THIRD_PARTY_NOTICES.md). This project is not affiliated with Google.
