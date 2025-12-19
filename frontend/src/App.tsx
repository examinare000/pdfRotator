import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createPdfJsDistLoader } from "./lib/pdfjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewerState } from "./hooks/useViewerState";
import { renderPageToCanvas } from "./lib/pdf";
import { savePdfWithRotation } from "./lib/pdf-save";
import { detectOrientationForPage, type OrientationSuggestion } from "./lib/ocr";
import { applyRotationChange, clampPageNumber } from "./lib/rotation";
import { computeFitToWidthZoom } from "./lib/fit";
import { fetchHealth, type HealthInfo } from "./lib/health";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { UploadPanel } from "./components/UploadPanel";
import "./App.css";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const DEFAULT_OCR_THRESHOLD = 0.6;

type RenderState = "idle" | "rendering" | "error";

const clampThreshold = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const isPdfFile = (file: File): boolean => {
  if (file.type === "application/pdf") {
    return true;
  }
  return file.name.toLowerCase().endsWith(".pdf");
};

const readFileAsArrayBuffer = async (file: Blob): Promise<ArrayBuffer> => {
  const anyFile = file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyFile.arrayBuffer === "function") {
    return await anyFile.arrayBuffer();
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
        return;
      }
      reject(new Error("ファイルの読み込みに失敗しました"));
    };
    reader.readAsArrayBuffer(file);
  });
};

function App() {
  const pdfLoader = useMemo(() => createPdfJsDistLoader({ workerSrc }), []);
  const {
    state,
    loadFromArrayBuffer,
    setPage,
    nextPage,
    prevPage,
    rotateCurrentPage,
    rotatePage,
    setZoom,
    reset,
  } = useViewerState({ loader: pdfLoader });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [fileName, setFileName] = useState<string>("");
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [ocrSuggestion, setOcrSuggestion] = useState<(OrientationSuggestion & { page: number }) | null>(
    null
  );
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ current: number; total: number; page: number } | null>(null);
  const [ocrThreshold, setOcrThreshold] = useState(DEFAULT_OCR_THRESHOLD);
  const [pageInput, setPageInput] = useState<string>("1");
  const [dragging, setDragging] = useState(false);
  const [fitToWidth, setFitToWidth] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);

  const handleFile = async (file: File) => {
    if (!isPdfFile(file)) {
      setMessage("PDFファイルを選択してください");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setMessage("ファイルサイズは300MB以内にしてください");
      return;
    }
    setMessage(null);
    setFileName(file.name);
    setOcrSuggestion(null);
    setOcrError(null);
    try {
      const buffer = await readFileAsArrayBuffer(file);
      await loadFromArrayBuffer(buffer);
      setOriginalBuffer(buffer);
    } catch (error) {
      const text = error instanceof Error ? error.message : "PDFの読み込みに失敗しました";
      setMessage(text);
      setOriginalBuffer(null);
    }
  };

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFile(file);
      event.target.value = "";
    }
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragging(false);
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  useEffect(() => {
    if (state.numPages > 0) {
      setPageInput(String(state.currentPage));
    } else {
      setPageInput("1");
    }
  }, [state.currentPage, state.numPages]);

  useEffect(() => {
    const pdfDoc = state.pdfDoc;
    if (!pdfDoc || !canvasRef.current || state.status !== "ready") {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRenderState("rendering");
      try {
        const page = await pdfDoc.getPage(state.currentPage);
        const rotation = state.rotationMap[state.currentPage] ?? 0;
        await renderPageToCanvas(page, canvasRef.current!, {
          scale: state.zoom,
          rotation,
        });
        if (!cancelled) {
          setRenderState("idle");
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState("error");
          const text = error instanceof Error ? error.message : "ページの描画に失敗しました";
          setMessage(text);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [state.pdfDoc, state.currentPage, state.rotationMap, state.zoom, state.status]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await fetchHealth();
        if (!cancelled) setHealth(next);
      } catch {
        if (!cancelled) setHealth(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFitToWidth = useCallback(() => {
    if (!fitToWidth) return;
    if (state.status !== "ready") return;
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const nextZoom = computeFitToWidthZoom({
      currentZoom: state.zoom,
      canvasWidth: canvas.width,
      containerWidth: container.clientWidth,
      padding: 24,
    });
    if (!nextZoom) return;
    if (Math.abs(nextZoom - state.zoom) < 0.02) return;
    setZoom(nextZoom);
  }, [fitToWidth, setZoom, state.status, state.zoom]);

  useEffect(() => {
    if (!fitToWidth) return;
    applyFitToWidth();
    const handler = () => applyFitToWidth();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [fitToWidth, applyFitToWidth, state.currentPage, state.rotationMap, renderState]);

  const canSave = originalBuffer !== null && originalBuffer.byteLength > 0 && state.status === "ready";

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setMessage("PDFが読み込まれていません");
      return;
    }
    try {
      await savePdfWithRotation(originalBuffer, state.rotationMap, {
        fileName: fileName || "rotated.pdf",
        enableFallbackOpen: true,
      });
      setMessage(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存に失敗しました";
      setMessage(text);
    }
  }, [canSave, originalBuffer, state.rotationMap, fileName]);

  useEffect(() => {
    if (state.status === "error") {
      setOriginalBuffer(null);
    }
  }, [state.status]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (state.status !== "ready") return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          rotateCurrentPage(90);
          break;
        case "ArrowLeft":
          e.preventDefault();
          rotateCurrentPage(-90);
          break;
        case "ArrowDown":
          e.preventDefault();
          nextPage();
          break;
        case "ArrowUp":
          e.preventDefault();
          prevPage();
          break;
        case "s":
        case "S":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (originalBuffer) {
              void handleSave();
            }
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.status, rotateCurrentPage, nextPage, prevPage, originalBuffer, state.rotationMap, fileName, handleSave]);

  const handleReset = () => {
    ocrAbortRef.current?.abort();
    reset();
    setOriginalBuffer(null);
    setFileName("");
    setMessage(null);
    setOcrSuggestion(null);
    setOcrError(null);
    setOcrLoading(false);
    setOcrProgress(null);
    setRenderState("idle");
    setFitToWidth(false);
  };

  const handleReselectPdf = () => {
    fileInputRef.current?.click();
  };

  const handlePageJump = () => {
    if (state.status !== "ready") {
      return;
    }
    const raw = Number(pageInput);
    if (!Number.isFinite(raw)) {
      setMessage("ページ番号が不正です");
      return;
    }
    const nextPageNumber = clampPageNumber(raw, state.numPages);
    setPage(nextPageNumber);
    setMessage(null);
  };

  useEffect(() => {
    return () => {
      ocrAbortRef.current?.abort();
    };
  }, []);

  const handleDetectOrientation = async () => {
    if (health && !health.ocrEnabled) {
      setOcrError("OCRは無効化されています");
      return;
    }
    if (!state.pdfDoc) {
      setOcrError("PDFを読み込んでから実行してください");
      return;
    }

    ocrAbortRef.current?.abort();
    const abortController = new AbortController();
    ocrAbortRef.current = abortController;

    const fetcher: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: abortController.signal });

    const startPage = state.currentPage;
    const endPage = state.numPages;
    const total = Math.max(0, endPage - startPage + 1);

    setOcrLoading(true);
    setOcrError(null);
    setOcrProgress(total > 0 ? { current: 0, total, page: startPage } : null);

    try {
      let workingRotationMap = state.rotationMap;
      const errors: Array<{ page: number; message: string }> = [];

      for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
        if (abortController.signal.aborted) {
          throw new Error("OCR処理が中断されました");
        }

        setOcrProgress({
          current: pageNumber - startPage + 1,
          total,
          page: pageNumber,
        });

        try {
          const suggestion = await detectOrientationForPage(state.pdfDoc, pageNumber, {
            fetcher,
            threshold: ocrThreshold,
          });
          setOcrSuggestion(suggestion);

          if (suggestion.rotation === null) {
            continue;
          }

          const currentRotation = workingRotationMap[pageNumber] ?? 0;
          const delta = suggestion.rotation - currentRotation;
          if (delta === 0) {
            continue;
          }

          rotatePage(pageNumber, delta);
          workingRotationMap = applyRotationChange(workingRotationMap, pageNumber, delta);
        } catch (error) {
          const text = error instanceof Error ? error.message : "OCRの推定に失敗しました";
          errors.push({ page: pageNumber, message: text });
        }
      }

      if (errors.length > 0) {
        setOcrError(`${errors.length}ページでOCRに失敗しました（例: ${errors[0].page}ページ）`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "OCRの推定に失敗しました";
      setOcrError(text);
    } finally {
      setOcrLoading(false);
      setOcrProgress(null);
    }
  };

  const suggestionText =
    ocrSuggestion && state.pdfDoc
      ? ocrSuggestion.rotation === null
        ? "向きを特定できませんでした"
        : `${ocrSuggestion.rotation}° / 信頼度 ${ocrSuggestion.confidence.toFixed(2)}`
      : "未推定";

  const toastText = ocrError ?? message;
  const versionText = health?.version ? `v${health.version}` : "v--";

  return (
    <div className="app">
      <div className="glow glow--one" />
      <div className="glow glow--two" />

      <Header
        fileName={fileName}
        onReset={handleReset}
        onHelpOpen={() => setHelpOpen(true)}
      />

      <div className="workspace">
        <div className="workspace__main">
          <section className="panel viewer">
            <div className="viewer__top">
              <div className="status">
                <span className={`pill pill--${state.status}`}>状態: {state.status}</span>
                {renderState === "rendering" && <span className="pill pill--render">描画中...</span>}
              </div>
              <div className="viewer__meta">
                <span className="meta-badge">ページ {state.currentPage} / {state.numPages || "--"}</span>
                <span className="meta-badge">ズーム {state.zoom.toFixed(2)}x</span>
              </div>
            </div>
            <div className="viewer__canvas" ref={canvasContainerRef}>
              {!state.pdfDoc && <div className="placeholder">PDFを読み込むとここに表示されます</div>}
              {renderState === "rendering" && state.pdfDoc && (
                <div className="viewer__overlay" role="status" aria-label="描画中">
                  描画中...
                </div>
              )}
              <canvas ref={canvasRef} />
            </div>
            <div className="viewer__actions">
              <button
                className="save-btn"
                onClick={() => handleSave()}
                disabled={!canSave}
              >
                適用して保存 (Ctrl+S)
              </button>
              <div className="footnote">
                {state.errorMessage && <span className="error-text">{state.errorMessage}</span>}
                {message && <span className="error-text">{message}</span>}
              </div>
            </div>
          </section>
        </div>

        <div className="workspace__side">
          <UploadPanel
            dragging={dragging}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            fileInputRef={fileInputRef}
            onFileChange={handleFileInput}
            onReselect={handleReselectPdf}
            disabled={state.status === "loading"}
          />

          <section className="panel controls">
            <div className="controls__group">
              <p className="label">ページ</p>
              <div className="button-row">
                <button onClick={prevPage} disabled={state.currentPage <= 1 || state.status !== "ready"}>
                  前へ
                </button>
                <span className="page-indicator">
                  {state.currentPage} / {state.numPages || "--"}
                </span>
                <button
                  onClick={nextPage}
                  disabled={state.currentPage >= state.numPages || state.status !== "ready"}
                >
                  次へ
                </button>
              </div>
              <div className="button-row">
                <input
                  className="number-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={state.numPages || 1}
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handlePageJump();
                    }
                  }}
                  disabled={state.status !== "ready"}
                  aria-label="ページ番号入力"
                />
                <button onClick={handlePageJump} disabled={state.status !== "ready"}>
                  移動
                </button>
              </div>
            </div>
            <div className="controls__group">
              <p className="label">OCR向き推定</p>
              <div className="threshold-row">
                <label className="threshold-label">
                  しきい値
                  <input
                    className="number-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ocrThreshold}
                    onChange={(event) => setOcrThreshold(clampThreshold(Number(event.target.value)))}
                    disabled={state.status !== "ready"}
                    aria-label="OCR信頼度しきい値"
                  />
                </label>
                <span className="threshold-value">{Math.round(ocrThreshold * 100)}%</span>
              </div>
              <div className="button-row">
                <button
                  onClick={handleDetectOrientation}
                  disabled={state.status !== "ready" || ocrLoading || (health?.ocrEnabled === false)}
                >
                  {ocrLoading ? "推定中..." : "向き推定"}
                </button>
              </div>
              <div className="ocr-status">
                <div className="ocr-summary">
                  <span className="label inline">推定</span>
                  <span>{suggestionText}</span>
                  {ocrSuggestion?.processingMs !== undefined && (
                    <span className="pill pill--render">処理 {ocrSuggestion.processingMs}ms</span>
                  )}
                  {ocrProgress && (
                    <span className="pill pill--render">
                      {ocrProgress.current}/{ocrProgress.total}（{ocrProgress.page}ページ）
                    </span>
                  )}
                </div>
                {health?.ocrEnabled === false ? (
                  <p className="hint">OCRが無効化されています（`OCR_ENABLED=false`）。</p>
                ) : (
                  <p className="hint">
                    現在ページ以降を順番に画像化し、サーバーで向きを推定して自動適用します（しきい値 {ocrThreshold}）。
                  </p>
                )}
                {ocrSuggestion && <p className="hint">推定対象ページ: {ocrSuggestion.page}</p>}
                {ocrError && <span className="error-text">{ocrError}</span>}
              </div>
            </div>
            <div className="controls__group">
              <p className="label">回転</p>
              <div className="button-row">
                <button onClick={() => rotateCurrentPage(-90)} disabled={state.status !== "ready"}>
                  -90°
                </button>
                <button onClick={() => rotateCurrentPage(90)} disabled={state.status !== "ready"}>
                  +90°
                </button>
              </div>
            </div>
            <div className="controls__group">
              <p className="label">ズーム</p>
              <div className="button-row">
                <button onClick={() => setZoom(state.zoom - 0.25)} disabled={state.status === "idle" || fitToWidth}>
                  -
                </button>
                <span className="page-indicator">{state.zoom.toFixed(2)}x</span>
                <button onClick={() => setZoom(state.zoom + 0.25)} disabled={state.status === "idle" || fitToWidth}>
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !fitToWidth;
                    setFitToWidth(next);
                    if (next) {
                      applyFitToWidth();
                    }
                  }}
                  disabled={state.status !== "ready"}
                  aria-pressed={fitToWidth}
                >
                  幅に合わせる
                </button>
              </div>
            </div>
          </section>

          <ShortcutsPanel />
        </div>
      </div>

      <Footer version={versionText} />

      {toastText && (
        <div className="toast" role="status" aria-label="通知">
          <span>{toastText}</span>
          <button type="button" onClick={() => { setMessage(null); setOcrError(null); }}>
            閉じる
          </button>
        </div>
      )}

      {helpOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="ヘルプ">
          <div className="modal__backdrop" onClick={() => setHelpOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <h2>ヘルプ</h2>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="閉じる">
                ×
              </button>
            </div>
            <div className="modal__body">
              <p className="hint">
                PDFはブラウザ内で処理します。OCR実行時のみ、現在ページの画像をサーバへ送信します。
              </p>
              <p className="label">ショートカット</p>
              <ul className="help-list">
                <li>→: +90° 回転</li>
                <li>←: -90° 回転</li>
                <li>↓ / ↑: ページ移動</li>
                <li>Ctrl/Cmd + S: 回転を適用して保存</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
