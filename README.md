# Gemini Search Bridge userscript

PiP小窓を使い、Google検索にGeminiの途中回答・完成回答を表示するユーザースクリプトです。
Chrome拡張版とは独立して管理します。

検索側は起動ボタンだけから始まります。Gemini側でPiPを開くと自動送信を開始します。
PiPを表示している間、元のGeminiウィンドウは最小化できますが、閉じないでください。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

配布ファイルは `outputs/userscript/gemini-search-bridge.user.js` です。
Vite により TypeScript を単一 IIFE にバンドルし、minify は行いません。
利用手順と制限は [docs/USERSCRIPT.md](docs/USERSCRIPT.md) を参照してください。

Gemini Web のネイティブ UI とユーザー自身のログイン状態を使用します。
Gemini API、非公開 RPC、Cookie の直接取得、外部バックエンドは使用しません。

MIT License
