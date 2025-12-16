# PDF Rotator

React/Vite 製の PDF ビューワ & 回転ツールと、OCR でページ向きを推定する Express API のモノレポです。ページ単位の回転を保存しつつ、矢印キー操作と OCR レコメンドで素早く整形できます。

## 主な機能
- PDF をブラウザ上で表示し、ページ単位で ±90° 回転・ズーム・ページ移動
- ↑↓ と →(＋90°) / ←(−90°) のショートカット、Ctrl/Cmd+S で保存
- 現在ページを画像化して `/api/ocr/orientation` に送り、向きと信頼度を表示・適用
- pdf-lib で回転を適用した PDF をローカルにダウンロード（`rotated.pdf` 相当）
- PDF 本体はブラウザ内のみで処理し、OCR 時のみ対象ページの画像を送信

## ディレクトリ構成
- `frontend/` : React + TypeScript + Vite。`public/pdf.worker.js` に PDF.js worker を配置。
- `server/` : Express + TypeScript。OCR API と静的配信（ビルド成果物を `public/` へ）。
- `docs/` : 設計/ADR。詳細は `docs/design/detailed_design.md` を参照。
- `scripts/` : 配布用 PowerShell スクリプト `package-win.ps1`。

## 前提
- Node.js 20+（package-win.ps1 は Node 24 系を想定）
- PowerShell 7 以上（Windows 配布パッケージ生成時）

## セットアップ
```bash
# フロントエンド
cd frontend
npm ci

# バックエンド
cd ../server
npm ci
```

## 開発起動
別ターミナルでフロントとサーバを起動します。
```bash
cd server
npm run dev   # http://localhost:3001

cd ../frontend
npm run dev   # http://localhost:5173
```
デフォルトの CORS 設定は `CORS_ORIGIN=http://localhost:5173` です。フロントは `/api/*` をサーバへプロキシせず直接呼び出します。

## サーバ環境変数 (`server/.env`)
- `PORT` (default: 3001)
- `CORS_ORIGIN` : 許可するオリジン
- `OCR_TIMEOUT_MS` : OCR タイムアウト（ms）
- `OCR_ENABLED` : `false` で OCR API を無効化
- `STATIC_DIR` : 静的配信ディレクトリ（未設定時は `server/public`）

## API メモ
- `GET /api/health` : `{ status, version }`
- `POST /api/ocr/orientation`
  - 入力: `multipart/form-data` の `file`(png/jpeg, 50MB) または `application/json` `{ imageBase64, threshold? }`
  - 出力: `{ success: true, rotation: 0|90|180|270|null, confidence, textSample?, processingMs }`
  - エラー: 400/413/503/504/500 を JSON で返却

## ビルドと配布
```bash
# フロントエンドビルド（dist 作成）
cd frontend && npm run build

# サーバビルド（dist/index.js）
cd ../server && npm run build

# 本番起動（ビルド済み前提）
npm run start
```
Windows 向け配布 ZIP は PowerShell で生成します。
```powershell
pwsh scripts/package-win.ps1          # Node を同梱しない
pwsh scripts/package-win.ps1 -IncludeNode  # node.exe を同梱
# -> release/pdfrotator-win64.zip を生成。展開後は start.cmd を実行。
```

## テスト・ユーティリティ
- `frontend`: `npm test` (Vitest + RTL), `npm run lint`, `npm run measure:pages` でページ数別の初期描画計測
- `server`: `npm test` (Vitest + Supertest)

## 使い方のヒント
- 50MB 以内の PDF を `ファイルを選択` で読み込み。状態はリセットボタンで初期化。
- 回転はボタンまたはキーボード（→/← で回転＋次ページ）。ズームは 0.25〜3.0x にクランプ。
- 「向き推定」で現在ページを OCR し、信頼度と推定角度を表示。「提案を適用」で回転に反映。
- 「適用して保存」または Ctrl/Cmd+S で回転を焼き込んだ PDF をダウンロード。
