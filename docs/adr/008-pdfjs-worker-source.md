# ADR-008: PDF.js Workerの配信方式をpdfjs-dist同梱に統一

## ステータス
採用済み（2025-12-23）

## 背景
- `public/pdf.worker.js` を手動で配置していたが、`pdfjs-dist` 更新と同期が取れず、API version mismatch が発生する。
- ドラッグ&ドロップ/再選択の読み込みが `PDFの読み込みに失敗しました` で停止する事例が確認された。

## 決定
- PDF.js worker は `pdfjs-dist` 付属の `build/pdf.worker.min.mjs` を Vite のアセット解決で配信する。
- `GlobalWorkerOptions.workerSrc` は `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` の結果を既定値として設定する。
- 明示的な `workerSrc` 指定は引き続き許容する（テスト/検証用途）。

## 根拠
- PDF.js 本体と同一バージョンの worker を常に利用でき、バージョン不整合を防げる。
- 手動での worker 更新作業を不要にし、保守コストとヒューマンエラーを削減できる。

## トレードオフ
- ビルド出力に worker アセットが含まれる（サイズ増）。
- `public/` へ静的に置くだけの運用より、ビルド依存が増える。

## 影響範囲
- フロントの PDF.js 初期化 (`lib/pdf.ts`, `lib/pdfjs.ts`)。
- 詳細設計書/関連ADR内の worker 配信記述。
