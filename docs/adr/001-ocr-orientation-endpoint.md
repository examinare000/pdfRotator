# ADR-001: OCR向き判定APIの設計方針

## ステータス
採用済み（2025-12-15）

## 背景
- MVP要件で「OCRによる向きレコメンド」を提供する必要がある。
- 既存サーバ実装はプレースホルダで、UI側の統合や信頼性要件を満たしていなかった。
- Tesseract.js を採用済みであるため、同ライブラリを活用した最小の向き判定エンドポイントを決定する。

## 決定
- エンドポイント: `POST /api/ocr/orientation`
- 入力
  - `multipart/form-data` の `file` (image/png/jpeg, 5MB以内) または `application/json` の `imageBase64`
  - 任意パラメータ `threshold`（0..1、デフォルト0.6）
- 出力
  - 200: `{ success: true, rotation: 0|90|180|270|null, confidence: number, textSample?: string, processingMs: number }`
  - 400: バリデーションエラー（画像未提供、不正形式、閾値不正、非対応MIME）
  - 413: ファイルサイズ超過
  - 503: `OCR_ENABLED=false` 時に機能無効
  - 504: OCR処理のタイムアウト
  - 500: 上記以外の内部エラー（一般化メッセージ）
- タイムアウト: `OCR_TIMEOUT_MS`（デフォルト1500ms）で強制終了、504を返す。
- 実装詳細
  - multer のメモリストレージで画像をメモリのみで扱う。
  - 画像形式制限（png/jpeg）。Base64はプレフィックス付き/無しの双方を許容し、簡易バリデーションを実施。
  - Tesseract.js `detect` の `orientation_degrees` と `orientation_confidence` を使用し、90度単位に正規化する。
  - 閾値未達の場合は rotation を `null` に上書きする。
  - 依存注入可能な `OrientationDetector` 抽象化を用意し、テストでスタブ化する。
- ロギング: リクエストエラーは warn、その他は info/ error で構造化JSON出力する。

## 根拠
- フロントのUX要件（短時間でのレスポンス、エラー文言の日本語化）を満たす。
- メモリストレージ運用でディスクI/Oを避け、セキュリティリスクを低減。
- 90度単位の回転のみをUIが扱うため、正規化をサーバ側でも保証する。
- タイムアウトと機能フラグで信頼性を担保し、フロントのリトライ戦略と整合。

## トレードオフ
- メモリ使用量が増えるが、5MB上限で許容。
- テキスト抽出（`textSample`）は現状返却しないため、将来的なデバッグ用途では追加実装が必要。
- レート制限は1分60リクエストの簡易設定であり、実運用ではIP単位の調整が必要。

## 採用した代替案と理由
- 代替案: フロントでのみOCRを実施しサーバAPIを不要にする  
  - 理由: ブラウザ環境でのTesseract実行コストとワーカー管理の複雑性が高く、バックエンド集中の方が制御しやすい。
- 代替案: 画像を一旦ファイル保存して処理  
  - 理由: セキュリティ/パフォーマンスの観点でメモリ完結の方が優れるため不採用。

## 影響範囲
- バックエンド: `/api/ocr/orientation` 実装・設定値追加。
- フロントエンド: レスポンス構造（`success`, `rotation`, `confidence`, `processingMs`）に合わせたUI更新が必要。
- 運用: 環境変数 `OCR_ENABLED`, `OCR_TIMEOUT_MS`, `CORS_ORIGIN` の管理。
