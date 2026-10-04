# Gemini Search Bridge userscript

Chrome 拡張版から、動作確認済みのユーザースクリプト v0.3 を独立させたリポジトリです。
初回コミットは PiP-first 改修前の保存地点です。拡張版のリポジトリとは独立して管理します。

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
