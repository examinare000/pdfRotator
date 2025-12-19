import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createPdfJsDistLoader } from "./lib/pdfjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewerState } from "./hooks/useViewerState";
import { renderPageToCanvas } from "./lib/pdf";
import { savePdfWithRotation } from "./lib/pdf-save";
import { detectOrientationForPage, type OrientationSuggestion } from "./lib/ocr";
import { clampPageNumber } from "./lib/rotation";
import "./App.css";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
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
    setZoom,
    reset,
  } = useViewerState({ loader: pdfLoader });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [ocrThreshold, setOcrThreshold] = useState(DEFAULT_OCR_THRESHOLD);
  const [pageInput, setPageInput] = useState<string>("1");
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (!isPdfFile(file)) {
      setMessage("PDFファイルを選択してください");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setMessage("ファイルサイズは50MB以内にしてください");
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
    if (!state.pdfDoc || !canvasRef.current || state.status !== "ready") {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRenderState("rendering");
      try {
        const page = await state.pdfDoc!.getPage(state.currentPage);
        const rotation = state.rotationMap[state.currentPage] ?? 0;
        await renderPageToCanvas(page as any, canvasRef.current!, {
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

  const handleSave = useCallback(async () => {
    if (!originalBuffer || originalBuffer.byteLength === 0 || state.status !== "ready") {
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
  }, [originalBuffer, state.rotationMap, state.status, fileName]);

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
          nextPage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          rotateCurrentPage(-90);
          nextPage();
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
    reset();
    setOriginalBuffer(null);
    setFileName("");
    setMessage(null);
    setOcrSuggestion(null);
    setOcrError(null);
    setOcrLoading(false);
    setRenderState("idle");
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

  const handleDetectOrientation = async () => {
    if (!state.pdfDoc) {
      setOcrError("PDFを読み込んでから実行してください");
      return;
    }
    setOcrLoading(true);
    setOcrError(null);
    try {
      const suggestion = await detectOrientationForPage(state.pdfDoc, state.currentPage, {
        fetcher: fetch,
        threshold: ocrThreshold,
      });
      setOcrSuggestion(suggestion);
    } catch (error) {
      const text = error instanceof Error ? error.message : "OCRの推定に失敗しました";
      setOcrSuggestion(null);
      setOcrError(text);
    } finally {
      setOcrLoading(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!ocrSuggestion || ocrSuggestion.rotation === null) {
      return;
    }
    if (ocrSuggestion.page !== state.currentPage) {
      setOcrError("推定結果が現在のページと一致しません");
      return;
    }
    const currentRotation = state.rotationMap[state.currentPage] ?? 0;
    const delta = ocrSuggestion.rotation - currentRotation;
    rotateCurrentPage(delta);
    setOcrError(null);
  };

  const suggestionText =
    ocrSuggestion && state.pdfDoc
      ? ocrSuggestion.rotation === null
        ? "向きを特定できませんでした"
        : `${ocrSuggestion.rotation}° / 信頼度 ${ocrSuggestion.confidence.toFixed(2)}`
      : "未推定";

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <div className="brand__eyebrow">
            <span className="dot" />
            <span>PDF Rotator</span>
          </div>
          <h1>Rotate with Precision</h1>
          <p className="sub">
            ページ単位の回転操作、OCRによる自動向き検出、キーボードショートカット対応。
          </p>
          <div className="badges">
            <span className="pill pill--ghost">Keyboard</span>
            <span className="pill pill--ghost">OCR</span>
            <span className="pill pill--ghost">Local</span>
          </div>
        </div>
        <div className="header-actions">
          <div className="file-chip">
            <span className="chip-label">File</span>
            <span className="chip-value">{fileName || "No file selected"}</span>
          </div>
          <button className="reset-btn" onClick={handleReset}>
            Reset
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="workspace__main">
          <section className="panel viewer">
            <div className="viewer__top">
              <div className="status">
                <span className={`pill pill--${state.status}`}>{state.status}</span>
                {renderState === "rendering" && <span className="pill pill--render">rendering</span>}
              </div>
              <div className="viewer__meta">
                <span className="meta-badge">{state.currentPage} / {state.numPages || "—"}</span>
                <span className="meta-badge">{state.zoom.toFixed(2)}×</span>
              </div>
            </div>
            <div className="viewer__canvas">
              {!state.pdfDoc && <div className="placeholder">Drop a PDF to begin</div>}
              <canvas ref={canvasRef} />
            </div>
            <div className="viewer__actions">
              <button
                className="save-btn"
                onClick={() => handleSave()}
                disabled={!originalBuffer || state.status !== "ready"}
              >
                Save with Rotations
              </button>
              <div className="footnote">
                {state.errorMessage && <span className="error-text">{state.errorMessage}</span>}
                {message && <span className="error-text">{message}</span>}
              </div>
            </div>
          </section>
        </div>

        <div className="workspace__side">
          <section className="panel upload">
            <div
              className={`upload__area ${dragging ? "upload__area--dragging" : ""}`}
              onDragEnter={handleDragEnter}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              aria-label="Drop PDF here"
            >
              <div>
                <p className="label">Upload</p>
                <p className="hint">PDF files up to 50MB. Drag & drop or click to browse.</p>
              </div>
              <div className="upload__controls">
                <label className="upload__btn">
                  <input type="file" accept="application/pdf" onChange={handleFileInput} />
                  Choose File
                </label>
              </div>
            </div>
          </section>

          <section className="panel controls">
            <div className="controls__group">
              <p className="label">Page</p>
              <div className="button-row">
                <button onClick={prevPage} disabled={state.currentPage <= 1 || state.status !== "ready"}>
                  Prev
                </button>
                <span className="page-indicator">
                  {state.currentPage} / {state.numPages || "—"}
                </span>
                <button
                  onClick={nextPage}
                  disabled={state.currentPage >= state.numPages || state.status !== "ready"}
                >
                  Next
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
                  aria-label="Page number"
                />
                <button onClick={handlePageJump} disabled={state.status !== "ready"}>
                  Go
                </button>
              </div>
            </div>
            <div className="controls__group">
              <p className="label">OCR Detection</p>
              <div className="threshold-row">
                <label className="threshold-label">
                  Threshold
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
                    aria-label="OCR confidence threshold"
                  />
                </label>
                <span className="threshold-value">{Math.round(ocrThreshold * 100)}%</span>
              </div>
              <div className="button-row">
                <button
                  onClick={handleDetectOrientation}
                  disabled={state.status !== "ready" || ocrLoading}
                >
                  {ocrLoading ? "Detecting..." : "Detect"}
                </button>
                <button
                  onClick={handleApplySuggestion}
                  disabled={
                    state.status !== "ready"
                    || !ocrSuggestion
                    || ocrSuggestion.rotation === null
                    || ocrSuggestion.page !== state.currentPage
                  }
                >
                  Apply
                </button>
              </div>
              <div className="ocr-status">
                <div className="ocr-summary">
                  <span className="label inline">Result</span>
                  <span>{suggestionText}</span>
                  {ocrSuggestion?.processingMs !== undefined && (
                    <span className="pill pill--render">{ocrSuggestion.processingMs}ms</span>
                  )}
                </div>
                <p className="hint">Analyzes page orientation via server-side OCR.</p>
                {ocrSuggestion && <p className="hint">Target page: {ocrSuggestion.page}</p>}
                {ocrError && <span className="error-text">{ocrError}</span>}
              </div>
            </div>
            <div className="controls__group">
              <p className="label">Rotation</p>
              <div className="button-row">
                <button onClick={() => rotateCurrentPage(-90)} disabled={state.status !== "ready"}>
                  −90°
                </button>
                <button onClick={() => rotateCurrentPage(90)} disabled={state.status !== "ready"}>
                  +90°
                </button>
              </div>
            </div>
            <div className="controls__group">
              <p className="label">Zoom</p>
              <div className="button-row">
                <button onClick={() => setZoom(state.zoom - 0.25)} disabled={state.status === "idle"}>
                  −
                </button>
                <span className="page-indicator">{state.zoom.toFixed(2)}×</span>
                <button onClick={() => setZoom(state.zoom + 0.25)} disabled={state.status === "idle"}>
                  +
                </button>
              </div>
            </div>
          </section>

          <section className="panel shortcuts">
            <p className="label">Shortcuts</p>
            <div className="shortcut-grid">
              <div className="shortcut-card">
                <span className="kbd">→</span>
                <span>Rotate +90° & next</span>
              </div>
              <div className="shortcut-card">
                <span className="kbd">←</span>
                <span>Rotate −90° & next</span>
              </div>
              <div className="shortcut-card">
                <span className="kbd">↓ / ↑</span>
                <span>Navigate pages</span>
              </div>
              <div className="shortcut-card">
                <span className="kbd">⌘/Ctrl+S</span>
                <span>Save PDF</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
