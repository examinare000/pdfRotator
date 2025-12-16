import React, { useMemo, useState, type ChangeEvent } from "react";
import { requestOrientation, type OrientationResponse } from "../lib/ocr";

export type OrientationPanelProps = {
  pageNumber: number;
  getPageImage: () => Promise<string>;
  fetchOrientation?: (payload: { imageBase64: string; threshold: number }) => Promise<OrientationResponse>;
  onApply: (rotation: OrientationResponse["rotation"]) => void;
  defaultThreshold?: number;
};

const clampThreshold = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

export const OrientationPanel = ({
  pageNumber,
  getPageImage,
  fetchOrientation,
  onApply,
  defaultThreshold = 0.6,
}: OrientationPanelProps) => {
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [suggestion, setSuggestion] = useState<OrientationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requester = useMemo(
    () =>
      fetchOrientation ??
      ((payload: { imageBase64: string; threshold: number }) =>
        requestOrientation(payload.imageBase64, { threshold: payload.threshold })),
    [fetchOrientation]
  );

  const handleThresholdChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setThreshold(clampThreshold(next));
  };

  const handleDetect = async () => {
    setLoading(true);
    setError(null);
    try {
      const imageBase64 = await getPageImage();
      const result = await requester({ imageBase64, threshold });
      setSuggestion(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "OCRの呼び出しに失敗しました";
      setError(message);
      setSuggestion(null);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (suggestion?.rotation !== null) {
      onApply(suggestion.rotation);
    }
  };

  const confidenceText = suggestion ? `${Math.round(suggestion.confidence * 100)}%` : null;
  const rotationText =
    suggestion && suggestion.rotation !== null ? `${suggestion.rotation}°` : suggestion ? "判定不可" : null;

  return (
    <section aria-label={`ページ${pageNumber}の向き提案`} className="orientation-panel">
      <div className="threshold-control">
        <label className="threshold-label">
          信頼度しきい値
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            aria-label="信頼度しきい値"
            onChange={handleThresholdChange}
          />
          <span className="threshold-value">{Math.round(threshold * 100)}%</span>
        </label>
      </div>

      <button type="button" onClick={handleDetect} disabled={loading} aria-label="OCRで向きを提案">
        {loading ? "OCR処理中..." : "OCRで向きを提案"}
      </button>

      {error && (
        <p role="alert" className="error-text">
          OCR失敗: {error}
        </p>
      )}

      {suggestion && (
        <div className="suggestion">
          <p>
            推定角度: <strong>{rotationText}</strong>
          </p>
          <p>信頼度: {confidenceText}</p>
          {suggestion.processingMs !== undefined && <p>処理時間: {suggestion.processingMs}ms</p>}
          <button
            type="button"
            onClick={handleApply}
            disabled={loading || suggestion.rotation === null}
            aria-label="提案を適用"
          >
            提案を適用
          </button>
        </div>
      )}
    </section>
  );
};
