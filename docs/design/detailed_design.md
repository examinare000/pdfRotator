# 詳細設計書：PDFビューア・編集Webアプリ（完全版）

## 1. 目的・スコープ
- MVPの機能要件をすべて網羅し、実装に必要な詳細（UI動線、状態、API、例外系、非機能、テスト、運用）を定義する。
- スコープ：PDFサムネイル表示・拡大プレビュー・回転・保存、キーボード操作、OCR向きレコメンド。
- 非スコープ：電子署名、注釈/フォーム編集（拡張ポイントのみ記載）、オフライン対応。

## 2. 要件マッピング
- 表示：サムネイル一覧（4-5列、仮想スクロール）と拡大プレビュー、回転表示。
- 編集：複数ページ選択の回転保持、90/180度単位、適用で生成。
- 保存：ローカルに `rotated.pdf` ダウンロード。
- 操作性：クリック/ドラッグで選択、Ctrl/Cmd+矢印で回転、Escで解除、ダブルクリックでプレビュー。
- OCR：選択ページがあればそのページのみ、未選択なら全ページを向き推定（推定結果を自動適用）。
- 非機能：100ページ3秒以内初期表示、安全性（XSS/CSRF、依存CVE確認）、主要ブラウザ互換。

## 3. システム構成
- フロント：React + TypeScript + Vite、PDF.js（レンダリング）、pdf-lib（回転適用・保存）。PDF.js workerは `public/pdf.worker.js` として分離。
- バックエンド：Express + TypeScript、OCR APIのみ（CORS限定）。ログ: morgan + winston。
- ログ: サーバは `logs/server.log` / `logs/server-error.log` に出力し、フロントのエラーログも `/api/logs` 経由で同じログに集約する。
- OCR：Tesseract.js（Node）。入力PNG/JPEG→orientation/confidence→JSON返却。
- 開発時：Vite dev server（例:5173）は `/api/*` をバックエンド（例:3001）へプロキシして、フロント実装は `/api/...` の相対パスのままにする。
- 配布・ホスティング：フロントはViteビルド成果物を `server/public` に同梱し、Expressで静的配信+SPAフォールバック。Windows配布は zip 解凍 + `start.cmd` 実行のみで利用可能。

## 4. ユースケース/画面フロー
1) 初期表示：アップロードエリアのみ表示。  
2) PDF選択：ドラッグ&ドロップ/ファイル選択。拡張子/サイズ(上限例:300MB)検証 → PDF.js でロード → サムネイル一覧を生成。  
3) ページ選択：クリック/ドラッグで複数選択、ダブルクリックで拡大プレビュー。  
4) 回転：選択ページに対して -90/+90/180° を適用（Ctrl/Cmd+矢印）。  
5) OCRレコメンド：選択ページがあればそのページのみ、未選択なら全ページを順番に画像化→/api/ocr/orientation 呼び出し→推定角度と信頼度をUIに表示し、推定結果を回転マップに自動反映。  
6) 保存（適用）：`適用` クリックでpdf-libが元PDFに回転値を適用→Blob→`rotated.pdf` を自動ダウンロード。  
7) エラー動線：アップロード失敗/破損→モーダル通知。OCR失敗→トーストと再試行。保存失敗→代替表示（新規タブにBlob URL）。  
8) 再アップロード：新しいPDF選択時は状態をリセット（pageRotationMap/ocrSuggestion/selectedPages/preview）。

## 5. フロントエンド詳細
- コンポーネント
  - `App`: グローバル状態管理、ショートカット登録、レイアウト。
  - `UploadPanel`: DnD/ファイル入力、バリデーション（拡張子: pdf、サイズ: 300MB以内）。
  - `ViewerGrid`: サムネイル一覧の描画、選択状態の管理、スクロール領域。
  - `PreviewModal`: ダブルクリック時の拡大プレビュー（Escで閉じる）。
  - `RotateControls`: 選択ページの回転ボタン、選択解除。
  - `OrientationPanel`: OCRしきい値入力、推定結果表示（現在選択ページから順番に推定して自動適用）。
  - `ShortcutsPanel`: ショートカットの視覚的な案内。
- 状態/型（例）
  - `pdfDoc: PDFDocumentProxy | null`
  - `currentPage: number`（最後に選択/クリックしたページ）
  - `numPages: number`
  - `selectedPages: number[]`
  - `previewPage: number | null`
  - `pageRotationMap: Record<number, 0|90|180|270>`
  - `ocrSuggestion: { page: number; rotation: 0|90|180|270|null; confidence: number; processingMs?: number } | null`
  - `ui`: { loading: boolean; ocrLoading: boolean; error?: string }
- PDF.js設定
  - workerSrc を `public/pdf.worker.js` に配置し、`resolveWorkerSrc` で `BASE_URL` に追従しつつ `GlobalWorkerOptions.workerSrc` を設定。
- サムネイルは `renderPageToCanvas` で小さく描画し、回転はPDF.js viewportに反映する。仮想スクロールで表示中のページのみ描画する。
  - プレビューは別キャンバスに大きめの上限（例: 900x1200）で描画する。
- 回転ロジック
  - 入力は90度単位のみ許容：`normalize = ((value % 360) + 360) % 360`.
  - `pageRotationMap[page] = (prev + delta) % 360`.
  - 描画時：PDF.js viewport に現在の rotation を加算して render。
- キーボード操作
  - `keydown` グローバルリスナ。フォーム入力中は無効化。
  - Ctrl/Cmd + →: 選択を +90
  - Ctrl/Cmd + ←: 選択を -90
  - Ctrl/Cmd + ↑/↓: 選択を 180
  - Esc: 選択解除（プレビュー表示中は閉じる）
  - `Ctrl+S` はブラウザ保存を防ぎ、`適用` 相当の保存を実行（確認ダイアログなし）。
- エラー/UX
  - PDFロード失敗：`Unsupported PDF structure` 等はユーザーフレンドリな文言に変換。
  - OCR失敗：トーストに「OCR失敗。もう一度試す/サポートに連絡」。
  - 長時間処理：OCR > 1.5s でスピナーと「まもなく完了」表示。
- アクセシビリティ：主要ボタンに `aria-label`、キーボードフォーカス可能、モーダルはフォーカストラップ、コントラスト基準を満たす配色。
- パフォーマンス
- 初期表示：サムネイル一覧を順次描画。仮想スクロールで描画対象を限定し、サムネイルサイズを小さく保つことで描画負荷を抑える。
  - プレビューは必要時のみレンダリングする。
  - キャンバス最大幅/高さを clamp（例: サムネイル 180x240、プレビュー 900x1200）。`renderPageToCanvas` でスケールを自動調整。
  - 100ページPDFで3秒以内を目標に、ファイル読み込み+サムネイル描画の計測を実装（`cd frontend && npm run measure:pages` でサンプルPDF生成と計測を実行。`PAGE_COUNT` 環境変数でページ数を指定可能）。

## 6. バックエンド詳細（Express）
- API
  - `GET /api/health` → 200 `{ status, version }`
  - `POST /api/ocr/orientation`
    - Content-Type: `multipart/form-data` フィールド名 `file`（PNG/JPEG、50MB以内）、または `application/json` `{ imageBase64 }`
    - Query/Body: `threshold` (0-1, optional)。※現在は使用せず、固定尤度0.6で判定する。
    - Response 200: `{ success: true, rotation: 0|90|180|270|null, confidence: number, likelihood: number, textSample?: string, processingMs: number }`
    - 400: バリデーションエラー（画像未提供/非対応MIME/Base64不正/閾値不正）
    - 413: ファイルサイズ超過
    - 503: `OCR_ENABLED=false` で機能無効
    - 504: OCR処理タイムアウト（`OCR_TIMEOUT_MS`）
    - 429: レート制限 exceeded
    - 500: `{ success: false, message: "内部エラーが発生しました" }`
- ミドルウェア/セキュリティ
  - `helmet()`、`cors({ origin: CORS_ORIGIN, credentials: true })`
  - Rate limit: 60 req/min/IP
  - Payload: `json/urlencoded 70MB`, `multer` file 50MB
  - オプション: `csrf`（Cookie運用時）、JWTの場合はトークン検証ミドルウェア
- OCR処理
  - `OCR_ENABLED=false` なら 503 を返す。
- タイムアウト: `OCR_TIMEOUT_MS`（例:1500ms）で `Promise.race`。504で応答。
- 優先戦略: ページ下端（底辺）1/8領域のページ番号検出。
  - 短辺/長辺の各辺が底辺になるように 0/90/180/270 で `recognize` し、底辺1/8領域の数字トークン認識精度（Accuracy）最大の回転を採用。
- 次点戦略: `Tesseract.detect(buffer)` → `orientation_degrees` を 90 度単位に正規化、`orientation_confidence` を返却。
- `textSample` はベストエフォート（タイムアウトで打ち切り）で、`OCR_TEXT_SAMPLE_ENABLED` / `OCR_TEXT_SAMPLE_TIMEOUT_MS` で制御する。
- 尤度 < 0.6 の場合は `rotation: null` で返す。
- 画像はメモリ上でのみ保持し、保存しない。multer メモリストレージを使用。Base64 とファイルで同じバリデーションを共有。
- ロギング
  - リクエストID（`x-request-id` が無ければ生成）
  - 正常: method/path/status/duration
  - 失敗: stack はサーバログのみ、レスポンスには汎用メッセージ。

## 6.1 静的配信と配布
- 静的配信: `server/public` を `express.static` で配信し、非APIパスは `index.html` を返す（SPAフォールバック）。
- 配布: `scripts/package-win.ps1` により `frontend` をビルドし `server/public` に配置、`server` をビルド、必要なランタイムを `release/pdfrotator-win64.zip` にまとめる。node.exe は既定で同梱され、利用者は解凍して `start.cmd` を実行するだけで起動（配布先で Node.js 不要）。node.exe を同梱しない場合は `-NoNode` を使用する。
- 設定: `STATIC_DIR` 環境変数で静的配信パスを上書き可能（未設定時は `server/public`）。OCR設定は `OCR_ENABLED`, `OCR_TIMEOUT_MS`, `OCR_TEXT_SAMPLE_ENABLED`, `OCR_TEXT_SAMPLE_TIMEOUT_MS`, `CORS_ORIGIN` を使用。
  - `OCR_TIMEOUT_MS` は環境依存で調整する（目安: 15000ms）。重い環境ではより長くする。

## 7. PDF処理・保存ロジック（フロント）
- 保存手順
  1. pdf-lib で ArrayBuffer を読み込み `PDFDocument.load`.
  2. 全ページを走査し、`page.setRotation(degrees(pageRotationMap[page] || 0))`.
  3. `pdfDoc.save()` → Blob → `download('rotated.pdf')`。モバイルSafari向けに Blob URL を新規タブで開くフォールバックを持つ。
- データ保持
  - PDFファイルはブラウザ内メモリ/URL.createObjectURL のみで扱い、サーバへ送らない。
  - 回転マップはセッション中のみ保持。リロードでクリア。

## 8. エッジケースと対策
- 空ファイル/破損PDF：ロード失敗を捕捉し再アップロードを促す。
- 巨大ページサイズ：描画前に viewport サイズを clamp し OOM を回避。
- ページなしPDF（稀）：エラーメッセージ表示。
- OCR未対応/無効化：UIでボタンを無効化しツールチップに理由を表示。
- ネットワークエラー（OCR）：リトライボタン、オフライン時は即座に失敗にする。
- ブラウザ互換：Chrome/Edge/Safari 最新。PDF.js worker パスが解決しない場合のエラーメッセージを追加。

## 9. ファイル/設定構成（暫定）
- `frontend/`: React実装（`components/`, `hooks/`, `lib/pdf`, `styles`）。`public/pdf.worker.js` を配置。
- `server/`: Express実装（`src/index.ts`, `src/services/ocr.ts`, `src/middlewares/`）。`tsconfig.json`, `.env`.
- `docs/design/`: 設計/セットアップドキュメント。
- `.env`（server）: `PORT`, `CORS_ORIGIN`, `OCR_ENABLED`, `OCR_TIMEOUT_MS`, `OCR_TEXT_SAMPLE_ENABLED`, `OCR_TEXT_SAMPLE_TIMEOUT_MS`.

## 10. テスト計画
- 単体（フロント）
  - 回転正規化関数（±複数回の加算で 0/90/180/270 に収束すること）。
  - 選択操作（クリック/ドラッグ、Esc解除）の挙動。
  - ショートカットハンドラ（Ctrl/Cmd+矢印、フォームフォーカス時は無効）。
  - プレビュー表示（ダブルクリック、Escで閉じる）。
- 単体（サーバ）
  - OCR API バリデーション（拡張子/サイズ/必須フィールド）。
  - タイムアウト時は 504 相当の応答（または 408）を返すこと。
  - `OCR_ENABLED=false` の 503 応答。
- 結合/E2E
  - PDFロード→回転→保存で回転がPDFに反映されること（Playwright + pdf-lib で検証）。
  - OCR API モックでレコメンド→自動適用→保存までのシナリオ。
  - 100ページPDFで初期表示時間が3秒以内か計測。
- 非機能/セキュリティ
  - OWASP ZAP による簡易DAST（XSS/CSRF エンドポイント確認）。
  - `npm audit` をCIで実行し、重大CVEが無いこと。

## 11. セキュリティ・プライバシー
- XSS: Reactエスケープを維持、HTML挿入を禁止。トースト文言は定数。
- CSRF: Cookie運用時は CSRF トークンを付与。Bearer JWTの場合は CORS 制限を強化し CSRF ミドルウェアは無効。
- CORS: `CORS_ORIGIN` で許可ドメインを限定。`credentials` を必要な場合のみ true。
- ファイル扱い: PDFはブラウザ内のみ。OCR画像は都度送信し、サーバで保持しない。
- ログ: 個人情報を書き込まない。画像/バイナリはログしない。

## 12. 運用・監視
- ログローテーション: winston で日次ローテーション（本番時）。開発はコンソールのみ。
- メトリクス: OCRリクエスト数/成功率/タイムアウト率/平均処理時間。
- ヘルスチェック: `/api/health` をLB監視に登録。
- フィーチャーフラグ: `OCR_ENABLED` でOCR APIを無効化し、フロントはUIを非活性化。

## 13. 既知の課題/拡張ポイント
- 注釈・フォーム編集追加時はページごとのアノテーションレイヤーとpdf-lib拡張が必要。
- ページ並べ替え、オフライン対応、マルチPDFタブは将来拡張。
- 大容量PDF向けに、Web Worker を使った分割レンダリングを検討（現状は単一worker）。
