# 開発環境セットアップメモ

## 前提
- Node.js 24 LTS を winget でインストール済み。新しいターミナルで `node -v` / `npm -v` が通ることを確認。
  - もし既存シェルで認識されない場合は、一度シェルを開き直すか `setx PATH "%ProgramFiles%\\nodejs;%PATH%"` を実行。

## ルートから一括（推奨）
- セットアップ（frontend + server）: `npm run setup`
- テスト（frontend + server）: `npm test`
- ビルド（frontend + server）: `npm run build`
- 開発起動（frontend + server 同時起動）: `npm run dev`

## フロントエンド（React + Vite + TypeScript）
- ディレクトリ: `frontend/`
- 依存: React 19.2.3 / React DOM 19.2.3（更新方針は ADR-007 に準拠）
- セットアップ: `cd frontend && npm ci`
- 開発サーバ: `npm run dev`（デフォルト `http://localhost:5173`）
- ビルド: `npm run build`
- プレビュー: `npm run preview`

## バックエンド（Express + TypeScript）
- ディレクトリ: `server/`
- セットアップ: `cd server && npm ci`
- 環境変数サンプル: `server/.env.example` をコピーして `.env` を作成。
- 開発サーバ: `npm run dev`（デフォルト `http://localhost:3001`）
- ビルド: `npm run build`（成果物は `server/dist`）
- 本番起動: `npm start`
- API（暫定）
  - `GET /api/health` … ヘルスチェック（`ocrEnabled` を含む）
  - `POST /api/ocr/orientation` … OCR向き判定（Tesseract.js実装済み）

## リポジトリ構成（現状）
- `frontend/` … Vite標準テンプレート（React + TS）
- `server/` … Expressエントリ（`src/index.ts`）、TypeScript設定（`tsconfig.json`）、環境変数例（`.env.example`）
- `docs/design/` … 詳細設計、セットアップメモ

## 配布パッケージ作成（Windows向け）
- コマンド: `cd server && npm run package:win`
- 生成物: `release/pdfrotator-win64.zip`（解凍後に同梱の `start.cmd` を実行するだけ）
- 既定: `node.exe` を同梱（配布先に Node.js 不要）
- オプション: `pwsh ../scripts/package-win.ps1 -NoNode` で node.exe を同梱しない（配布先に Node.js が必要）
- リリース時は `main` にマージ後、タグ `v1.0.0` を付与してからパッケージを作成する

## 次にやること（提案）
1. フロントで PDF.js / pdf-lib を組み込み、回転UIとショートカットを実装。
2. OCR API とフロントを接続し、推定結果の表示/適用フローを組み込む。
3. ESLint/Prettier 設定を追加して CI で lint/build を走らせる。
