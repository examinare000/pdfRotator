# PDF Rotator

React/Vite 製の PDF ビューワ & 回転ツールと、OCR でページ向きを推定する Express API のモノレポです。ページ単位の回転を保存しつつ、矢印キー操作と OCR レコメンドで素早く整形できます。

## 配布版（Windows）のダウンロード
- GitHub Releases（最新版）: https://github.com/examinare000/pdfRotator/releases/latest
  - Assets から `pdfrotator-win64.zip` をダウンロードしてください。

## 主な機能
- PDF をブラウザ上で表示し、ページ単位で ±90° 回転・ズーム・ページ移動
- ↑↓ と →(＋90°) / ←(−90°) のショートカット、Ctrl/Cmd+S で保存
- 現在ページを画像化して `/api/ocr/orientation` に送り、向きと信頼度を表示・適用
- 複数ページのOCR向き推定、進捗表示、中止/再開、連続回転（高尤度の同方向判定に挟まれたページを一括回転）
- 拡大プレビュー表示中もPDFをドラッグ&ドロップで再読み込み可能
- pdf-lib で回転を適用した PDF をローカルにダウンロード（`rotated.pdf` 相当）
- PDF 本体はブラウザ内のみで処理し、OCR 時のみ対象ページの画像を送信

## ディレクトリ構成
- `frontend/` : React + TypeScript + Vite。`public/pdf.worker.js` に PDF.js worker を配置。
- `server/` : Express + TypeScript。OCR API と静的配信（ビルド成果物を `public/` へ）。
- `docs/` : 設計/ADR。詳細は `docs/design/detailed_design.md` を参照。
- `scripts/` : 配布用 PowerShell スクリプト `package-win.ps1`。

## 前提
- 開発/ビルド用: Node.js 20+（`scripts/package-win.ps1` は Node 24 系を想定）
- PowerShell 7 以上（Windows 配布パッケージ生成時）

## 配布版の使い方（Windows）
1. Releases から `pdfrotator-win64.zip` をダウンロードして展開
2. （任意）`.env.example` を `.env` にコピーして設定（例: `PORT=3001`, `OCR_ENABLED=false`）
3. `start.cmd` を実行
4. ブラウザで `http://localhost:3001`（`PORT` を変えた場合はその値）を開く

補足:
- 通常の配布物は `node.exe` を同梱しているため、Node.js の別途インストールは不要です。
- `-NoNode` オプションで `node.exe` を同梱しない配布物を作った場合は、別途 Node.js をインストールして `node` が PATH で解決できる必要があります。
- OCR を有効化している場合、環境によっては初回実行時に追加データの取得が発生することがあります（オフライン運用したい場合は `OCR_ENABLED=false` を推奨）。

## セットアップ
```bash
# ルートから一括
npm run setup

# 個別に行う場合:
# cd frontend && npm ci
# cd server && npm ci
```

## 開発起動
ルートからフロントとサーバを同時起動できます。
```bash
npm run dev
```
個別に起動する場合は、別ターミナルでフロントとサーバを起動します。
```bash
cd server
npm run dev   # http://localhost:3001

cd ../frontend
npm run dev   # http://localhost:5173
```
デフォルトの CORS 設定は `CORS_ORIGIN=http://localhost:5173` です。開発時は `frontend/vite.config.ts` の proxy により、フロントから `/api/*` を相対パスのまま `http://localhost:3001` へ転送します。

## サーバ環境変数 (`server/.env`)
- `PORT` (default: 3001)
- `CORS_ORIGIN` : 許可するオリジン
- `OCR_TIMEOUT_MS` : OCR タイムアウト（ms, 目安: 8000）
- `OCR_ENABLED` : `false` で OCR API を無効化
- `STATIC_DIR` : 静的配信ディレクトリ（未設定時は `server/public`）

## API メモ
- `GET /api/health` : `{ status, version, ocrEnabled }`
- `POST /api/ocr/orientation`
  - 入力: `multipart/form-data` の `file`(png/jpeg, 50MB) または `application/json` `{ imageBase64, threshold? }`
  - 出力: `{ success: true, rotation: 0|90|180|270|null, confidence, textSample?, processingMs }`
  - エラー: 400/413/503/504/500 を JSON で返却

## ログ
- サーバログ: `logs/server.log`（info以上）、`logs/server-error.log`（error）
- フロントのエラーは `/api/logs` 経由で同じログに集約されます。

## ビルドと配布
```bash
# ルートから一括ビルド
npm run build

# 個別に行う場合:
# cd frontend && npm run build
# cd server && npm run build

# 本番起動（ビルド済み前提）
npm run start
```
Windows 向け配布 ZIP は PowerShell で生成し、GitHub Releases の Assets として配布します。
```powershell
pwsh scripts/package-win.ps1          # 既定で node.exe を同梱（配布先でNode.js不要）
pwsh scripts/package-win.ps1 -NoNode  # node.exe を同梱しない（配布先でNode.jsが必要）
# node.exe を明示する場合:
pwsh scripts/package-win.ps1 -NodeExePath "C:\\Program Files\\nodejs\\node.exe"
# -> release/pdfrotator-win64.zip を生成。展開後は start.cmd を実行。
```

## テスト・ユーティリティ
- ルート: `npm test`（frontend + server を一括実行）
- `frontend`: `npm test` (Vitest + RTL), `npm run lint`, `npm run measure:pages` でページ数別の初期描画計測
- `server`: `npm test` (Vitest + Supertest)

## 使い方のヒント
- 300MB 以内の PDF を `ファイルを選択` で読み込み。状態はリセットボタンで初期化。
- 回転はボタンまたはキーボード（→/← で回転）。ズームは 0.25〜3.0x にクランプ。
- 「向き推定」で現在ページ以降を OCR して信頼度と推定角度を表示し、提案を自動で回転に反映。
- 複数ページ処理中は中止可能。中止後は再開ボタンが有効になり、連続回転はチェックボックスで有効化し基準尤度を調整可能。
- 「適用して保存」または Ctrl/Cmd+S で回転を焼き込んだ PDF をダウンロード。
