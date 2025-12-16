import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPdfJsDistLoader } from "./lib/pdfjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewerState } from "./hooks/useViewerState";
import { renderPageToCanvas } from "./lib/pdf";
import { savePdfWithRotation } from "./lib/pdf-save";
import { detectOrientationForPage, type OrientationSuggestion } from "./lib/ocr";
import "./App.css";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

type RenderState = "idle" | "rendering" | "error";

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
  const [fileName, setFileName] = useState<string>("");
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [ocrSuggestion, setOcrSuggestion] = useState<(OrientationSuggestion & { page: number }) | null>(
    null
  );
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf") {
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
    const buffer = await file.arrayBuffer();
    setOriginalBuffer(buffer);
    await loadFromArrayBuffer(buffer);
  };

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFile(file);
      event.target.value = "";
    }
  };

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
              void savePdfWithRotation(originalBuffer, state.rotationMap, { fileName: "rotated.pdf" });
            }
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.status, rotateCurrentPage, nextPage, prevPage]);

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

  const handleDetectOrientation = async () => {
    if (!state.pdfDoc) {
      setOcrError("PDFを読み込んでから実行してください");
      return;
    }
    setOcrLoading(true);
    setOcrError(null);
    try {
      const suggestion = await detectOrientationForPage(state.pdfDoc, state.currentPage, { fetcher: fetch });
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
        <div>
          <p className="eyebrow">PDF Rotator</p>
          <h1>PDFビューア & 回転</h1>
          <p className="sub">
            PDFを読み込み、ページごとの回転とページ移動をキーボード/ボタンで操作できます。
          </p>
        </div>
        <button className="reset-btn" onClick={handleReset}>
          状態をリセット
        </button>
      </header>

      <section className="panel upload">
        <div className="upload__area">
          <div>
            <p className="label">PDFアップロード</p>
            <p className="hint">50MB以内のPDF。選択後に自動で読み込みます。</p>
          </div>
          <div className="upload__controls">
            <label className="upload__btn">
              <input type="file" accept="application/pdf" onChange={handleFileInput} />
              ファイルを選択
            </label>
            {fileName && <span className="file-name">{fileName}</span>}
          </div>
        </div>
        <div className="status">
          <span className={`pill pill--${state.status}`}>状態: {state.status}</span>
          {renderState === "rendering" && <span className="pill pill--render">描画中...</span>}
          {state.errorMessage && <span className="error-text">{state.errorMessage}</span>}
          {message && <span className="error-text">{message}</span>}
        </div>
      </section>

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
        </div>
        <div className="controls__group">
          <p className="label">OCR向き推定</p>
          <div className="button-row">
            <button
              onClick={handleDetectOrientation}
              disabled={state.status !== "ready" || ocrLoading}
            >
              {ocrLoading ? "推定中..." : "向き推定"}
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
              提案を適用
            </button>
          </div>
          <div className="ocr-status">
            <div className="ocr-summary">
              <span className="label inline">推定</span>
              <span>{suggestionText}</span>
              {ocrSuggestion?.processingMs !== undefined && (
                <span className="pill pill--render">処理 {ocrSuggestion.processingMs}ms</span>
              )}
            </div>
            <p className="hint">現在のページを画像化し、サーバーで向きを推定します。</p>
            {ocrSuggestion && (
              <p className="hint">推定対象ページ: {ocrSuggestion.page}</p>
            )}
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
            <button onClick={() => setZoom(state.zoom - 0.25)} disabled={state.status === "idle"}>
              -
            </button>
            <span className="page-indicator">{state.zoom.toFixed(2)}x</span>
            <button onClick={() => setZoom(state.zoom + 0.25)} disabled={state.status === "idle"}>
              +
            </button>
          </div>
        </div>
      </section>

      <section className="panel viewer">
        <div className="viewer__canvas">
          {!state.pdfDoc && <div className="placeholder">PDFを読み込むとここに表示されます</div>}
          <canvas ref={canvasRef} />
        </div>
        <div className="shortcuts">
          <p className="label">ショートカット</p>
          <div className="shortcut-list">
            <span>→: +90° 回転して次ページ</span>
            <span>←: -90° 回転して次ページ</span>
            <span>↓: 次ページ / ↑: 前ページ</span>
            <span>Ctrl+S / Cmd+S: 回転を適用して保存</span>
          </div>
          <button
            className="save-btn"
            onClick={() =>
              originalBuffer
              && savePdfWithRotation(originalBuffer, state.rotationMap, {
                fileName: fileName || "rotated.pdf",
              })
            }
            disabled={!originalBuffer || state.status === "loading"}
          >
            保存 (Ctrl+S)
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
