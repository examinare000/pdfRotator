# ADR-004: フロントエンドの大容量依存を遅延読み込みする

## ステータス
採用済み（2025-12-23）

## 背景
- Vite のビルド時にチャンクサイズ警告が発生し、初期ロードのJSが肥大化していた。
- PDF.js 本体や pdf-lib は使用タイミングが限定的なため、初期バンドルから切り離す余地がある。
- PDF.js worker は `pdfjs-dist` 付属の `build/pdf.worker.min.mjs` を利用し、バージョン不整合を避ける。

## 決定
- PDF.js 本体（`pdfjs-dist`）と pdf-lib は **動的 import** で遅延読み込みする。
- PDF.js worker は `pdfjs-dist/build/pdf.worker.min.mjs` を利用し、Viteのアセット解決で配信する。

## 根拠
- 初期バンドルから大容量依存を分離でき、ビルド警告と初期ロードの負荷を低減できる。
- 本体と同一バージョンの worker を必ず利用でき、API version mismatch を防止できる。

## トレードオフ
- 初回ロード時に PDF 読み込みや保存処理で遅延が発生する可能性がある。
- 動的 import によるエラーハンドリングが必要になる。

## 影響範囲
- フロントエンド: `createPdfJsDistLoader` / `savePdfWithRotation` の遅延読み込み化、worker の参照見直し。
- ビルド: 初期チャンクのサイズ削減による警告解消。
