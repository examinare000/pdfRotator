import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import { createPdfJsDistLoader } from "./lib/pdfjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewerState } from "./hooks/useViewerState";
import { renderPageToCanvas } from "./lib/pdf";
import { savePdfWithRotation } from "./lib/pdf-save";
import { detectOrientationForPage, type OrientationSuggestion } from "./lib/ocr";
import { applyRotationChange } from "./lib/rotation";
import { fetchHealth, type HealthInfo } from "./lib/health";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { UploadPanel } from "./components/UploadPanel";
import "./App.css";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const OCR_AUTO_SCALE = 0.6;
const OCR_RETRY_SCALE = 0.45;
const CONTINUOUS_ROTATION_DEFAULT = 0.6;

type RenderState = "idle" | "rendering" | "error";
type SelectionMode = "add" | "remove";

const normalizeSelectedPages = (pages: number[], numPages: number): number[] => {
  if (numPages < 1) return [];
  const uniquePages = new Set<number>();
  for (const page of pages) {
    if (!Number.isFinite(page)) continue;
    const normalized = Math.trunc(page);
    if (normalized < 1 || normalized > numPages) continue;
    uniquePages.add(normalized);
  }
  return Array.from(uniquePages).sort((a, b) => a - b);
};

const THUMB_MIN_WIDTH = 140;
const THUMB_GRID_GAP = 12;
const THUMB_GRID_PADDING = 14;
const THUMB_ROW_BUFFER = 2;

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
    rotatePage,
    reset,
  } = useViewerState({ loader: pdfLoader });

  const thumbCanvasRef = useRef(new Map<number, HTMLCanvasElement | null>());
  const thumbMetaRef = useRef(new Map<number, { rotation: number }>());
  const thumbRenderQueueRef = useRef(new Map<number, Promise<void>>());
  const rowHeightRef = useRef(260);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const selectingRef = useRef(false);
  const selectionModeRef = useRef<SelectionMode>("add");
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
  const [ocrCompleteMessage, setOcrCompleteMessage] = useState<string | null>(null);
  const [ocrResumeInfo, setOcrResumeInfo] = useState<{
    targetPages: number[];
    options: { forceAll?: boolean };
    currentIndex: number;
    continuousRotation: boolean;
    lastHigh: { page: number; rotation: number } | null;
    threshold: number;
    highConfidenceRotations: Record<number, number>;
  } | null>(null);
  const [continuousRotationEnabled, setContinuousRotationEnabled] = useState(false);
  const [continuousRotationThreshold, setContinuousRotationThreshold] = useState(CONTINUOUS_ROTATION_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [rowHeight, setRowHeight] = useState(rowHeightRef.current);
  const [gridMetrics, setGridMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 0,
    containerWidth: 0,
  });
  const ocrAbortRef = useRef<AbortController | null>(null);
  const ocrRunRef = useRef<{
    targetPages: number[];
    options: { forceAll?: boolean };
    currentIndex: number;
    continuousRotation: boolean;
    lastHigh: { page: number; rotation: number } | null;
    threshold: number;
    highConfidenceRotations: Record<number, number>;
  } | null>(null);
  const autoOcrDocRef = useRef<unknown>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRenderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const viewerGridRef = useRef<HTMLDivElement | null>(null);
  const helpModalRef = useRef<HTMLDivElement | null>(null);
  const previewModalRef = useRef<HTMLDivElement | null>(null);

  const renderThumbnail = useCallback(
    async (pageNumber: number, canvas: HTMLCanvasElement) => {
      if (!state.pdfDoc || state.status !== "ready") return;
      const rotation = state.rotationMap[pageNumber] ?? 0;
      const meta = thumbMetaRef.current.get(pageNumber);
      if (meta?.rotation === rotation && canvas.width > 0) {
        return;
      }
      const queue = thumbRenderQueueRef.current;
      const previous = queue.get(pageNumber) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          const page = await state.pdfDoc!.getPage(pageNumber);
          await renderPageToCanvas(page, canvas, {
            scale: 1,
            rotation,
            maxWidth: 180,
            maxHeight: 240,
          });
          thumbMetaRef.current.set(pageNumber, { rotation });
        });
      queue.set(pageNumber, next);
      try {
        await next;
      } finally {
        if (queue.get(pageNumber) === next) {
          queue.delete(pageNumber);
        }
      }
    },
    [state.pdfDoc, state.rotationMap, state.status]
  );

  const setThumbCanvas = useCallback(
    (pageNumber: number) => (node: HTMLCanvasElement | null) => {
      thumbCanvasRef.current.set(pageNumber, node);
      if (!node) {
        thumbMetaRef.current.delete(pageNumber);
        return;
      }
      void renderThumbnail(pageNumber, node).catch((error) => {
        setRenderState("error");
        const text = error instanceof Error ? error.message : "サムネイルの描画に失敗しました";
        setMessage(text);
      });
    },
    [renderThumbnail]
  );

  const measureThumbCardRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (!rect.height) return;
    const nextHeight = Math.round(rect.height);
    if (Math.abs(nextHeight - rowHeightRef.current) < 2) return;
    rowHeightRef.current = nextHeight;
    setRowHeight(nextHeight);
  }, []);

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
    setOcrCompleteMessage(null);
    setOcrResumeInfo(null);
    try {
      const buffer = await readFileAsArrayBuffer(file);
      await loadFromArrayBuffer(buffer);
      setOriginalBuffer(buffer);
      setSelectedPages([]);
      setPreviewPage(null);
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

  const updateGridMetrics = useCallback(() => {
    const container = viewerGridRef.current;
    if (!container) return;
    setGridMetrics({
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      containerWidth: container.clientWidth,
    });
  }, []);

  useEffect(() => {
    const container = viewerGridRef.current;
    if (!container) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateGridMetrics();
      });
    };
    updateGridMetrics();
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateGridMetrics);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateGridMetrics);
    };
  }, [updateGridMetrics]);

  const thumbGridWindow = useMemo(() => {
    if (!state.pdfDoc || state.numPages <= 0) {
      return {
        pageNumbers: [],
        paddingTop: 0,
        paddingBottom: 0,
      };
    }
    const fallbackWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const fallbackHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const containerWidth = gridMetrics.containerWidth || fallbackWidth;
    const viewportHeight = gridMetrics.viewportHeight || fallbackHeight;
    const innerWidth = Math.max(0, containerWidth - THUMB_GRID_PADDING * 2);
    const columns = Math.max(
      1,
      Math.floor((innerWidth + THUMB_GRID_GAP) / (THUMB_MIN_WIDTH + THUMB_GRID_GAP))
    );
    const rowStride = rowHeight + THUMB_GRID_GAP;
    const totalRows = Math.ceil(state.numPages / columns);
    const startRow = Math.max(0, Math.floor(gridMetrics.scrollTop / rowStride) - THUMB_ROW_BUFFER);
    const endRow = Math.min(
      totalRows - 1,
      Math.floor((gridMetrics.scrollTop + viewportHeight) / rowStride) + THUMB_ROW_BUFFER
    );
    const startIndex = startRow * columns;
    const endIndex = Math.min(state.numPages, (endRow + 1) * columns);
    const pageNumbers = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      pageNumbers.push(index + 1);
    }
    return {
      pageNumbers,
      paddingTop: startRow * rowStride,
      paddingBottom: Math.max(0, (totalRows - endRow - 1) * rowStride),
    };
  }, [gridMetrics, rowHeight, state.numPages, state.pdfDoc]);

  useEffect(() => {
    const activeModal = previewPage !== null ? previewModalRef.current : helpOpen ? helpModalRef.current : null;
    if (!activeModal) return;

    const getFocusableElements = (): HTMLElement[] => {
      const elements = activeModal.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      return Array.from(elements).filter((el) => !el.hasAttribute("disabled"));
    };

    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = getFocusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen, previewPage]);

  useEffect(() => {
    if (!state.pdfDoc || state.status !== "ready") {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRenderState("rendering");
      try {
        for (const pageNumber of thumbGridWindow.pageNumbers) {
          if (cancelled) return;
          const canvas = thumbCanvasRef.current.get(pageNumber);
          if (!canvas) continue;
          await renderThumbnail(pageNumber, canvas);
        }
        if (!cancelled) {
          setRenderState("idle");
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState("error");
          const text = error instanceof Error ? error.message : "サムネイルの描画に失敗しました";
          setMessage(text);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [renderThumbnail, state.pdfDoc, state.rotationMap, state.status, thumbGridWindow.pageNumbers]);

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
    if (!state.pdfDoc) {
      setSelectedPages([]);
      setPreviewPage(null);
      return;
    }
    setSelectedPages([]);
    thumbMetaRef.current.clear();
  }, [state.pdfDoc]);

  useEffect(() => {
    const stopSelecting = () => {
      selectingRef.current = false;
    };
    window.addEventListener("pointerup", stopSelecting);
    window.addEventListener("pointercancel", stopSelecting);
    return () => {
      window.removeEventListener("pointerup", stopSelecting);
      window.removeEventListener("pointercancel", stopSelecting);
    };
  }, []);

  const applySelection = useCallback((pageNumber: number, mode: SelectionMode) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (mode === "add") {
        next.add(pageNumber);
      } else {
        next.delete(pageNumber);
      }
      return Array.from(next).sort((a, b) => a - b);
    });
  }, []);

  const handleThumbPointerDown = useCallback(
    (pageNumber: number, isSelected: boolean) => (event: PointerEvent<HTMLButtonElement>) => {
      if (state.status !== "ready") return;
      if (event.button !== 0) return;
      event.preventDefault();
      selectingRef.current = true;
      selectionModeRef.current = isSelected ? "remove" : "add";
      applySelection(pageNumber, selectionModeRef.current);
      setPage(pageNumber);
    },
    [applySelection, setPage, state.status]
  );

  const handleThumbPointerEnter = useCallback(
    (pageNumber: number) => (event: PointerEvent<HTMLButtonElement>) => {
      if (!selectingRef.current) return;
      if (event.buttons !== 1) return;
      applySelection(pageNumber, selectionModeRef.current);
    },
    [applySelection]
  );

  const handleThumbDoubleClick = useCallback(
    (pageNumber: number) => () => {
      if (state.status !== "ready") return;
      setPreviewPage(pageNumber);
    },
    [state.status]
  );

  const rotateSelectedPages = useCallback(
    (delta: number) => {
      if (selectedPages.length === 0) return;
      selectedPages.forEach((pageNumber) => rotatePage(pageNumber, delta));
    },
    [rotatePage, selectedPages]
  );

  useEffect(() => {
    const run = async () => {
      if (previewPage === null) return;
      if (!state.pdfDoc || state.status !== "ready") return;
      if (!previewCanvasRef.current) return;
      setRenderState("rendering");
      try {
        const page = await state.pdfDoc.getPage(previewPage);
        const rotation = state.rotationMap[previewPage] ?? 0;
        const previous = previewRenderQueueRef.current;
        const next = previous
          .catch(() => {})
          .then(() =>
            renderPageToCanvas(page, previewCanvasRef.current!, {
              scale: 1.6,
              rotation,
              maxWidth: 900,
              maxHeight: 1200,
            })
          )
          .then(() => undefined);
        previewRenderQueueRef.current = next;
        await next;
      } catch (error) {
        const text = error instanceof Error ? error.message : "プレビューの描画に失敗しました";
        setMessage(text);
      } finally {
        setRenderState("idle");
      }
    };
    void run();
  }, [previewPage, state.pdfDoc, state.rotationMap, state.status]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (state.status !== "ready") return;
      switch (e.key) {
        case "ArrowRight":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            rotateSelectedPages(90);
          }
          break;
        case "ArrowLeft":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            rotateSelectedPages(-90);
          }
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            rotateSelectedPages(180);
          }
          break;
        case "Escape":
          if (previewPage !== null) {
            setPreviewPage(null);
          } else {
            setSelectedPages([]);
          }
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
  }, [state.status, previewPage, rotateSelectedPages, originalBuffer, fileName, handleSave]);

  const handleReset = () => {
    ocrAbortRef.current?.abort();
    autoOcrDocRef.current = null;
    reset();
    setOriginalBuffer(null);
    setFileName("");
    setMessage(null);
    setOcrSuggestion(null);
    setOcrError(null);
    setOcrLoading(false);
    setOcrProgress(null);
    setOcrCompleteMessage(null);
    setOcrResumeInfo(null);
    setRenderState("idle");
    setSelectedPages([]);
    setPreviewPage(null);
    thumbMetaRef.current.clear();
  };

  const handleReselectPdf = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    return () => {
      ocrAbortRef.current?.abort();
    };
  }, []);

  const handleDetectOrientation = useCallback(async (options: {
    forceAll?: boolean;
    resume?: {
      targetPages: number[];
      options: { forceAll?: boolean };
      currentIndex: number;
      continuousRotation: boolean;
      lastHigh: { page: number; rotation: number } | null;
      threshold: number;
      highConfidenceRotations: Record<number, number>;
    };
  } = {}) => {
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

    const resumeInfo = options.resume ?? null;
    const continuousRotation = resumeInfo?.continuousRotation ?? continuousRotationEnabled;
    const continuousRotationThresholdValue = resumeInfo?.threshold ?? continuousRotationThreshold;
    const normalizedSelection = options.forceAll
      ? []
      : normalizeSelectedPages(selectedPages, state.numPages);
    const targetPages = resumeInfo?.targetPages
      ?? (normalizedSelection.length > 0
        ? normalizedSelection
        : Array.from({ length: state.numPages }, (_, index) => index + 1));
    const total = targetPages.length;
    const startIndex = resumeInfo?.currentIndex ?? 0;
    const runOptions = resumeInfo?.options ?? { forceAll: options.forceAll };
    let lastHigh = resumeInfo?.lastHigh ?? null;
    const highConfidenceRotations = { ...(resumeInfo?.highConfidenceRotations ?? {}) };

    setOcrLoading(true);
    setOcrError(null);
    setOcrCompleteMessage(null);
    setOcrResumeInfo(null);
    setOcrProgress(
      total > 0
        ? { current: Math.min(startIndex, total), total, page: targetPages[Math.min(startIndex, total - 1)] }
        : null
    );

    try {
      let workingRotationMap = state.rotationMap;
      const errors: Array<{ page: number; message: string }> = [];
      const targetPagesSet = new Set(targetPages);
      const applyRotationToPage = (targetPage: number, targetRotation: number) => {
        const currentRotation = workingRotationMap[targetPage] ?? 0;
        const delta = targetRotation - currentRotation;
        if (delta === 0) return;
        rotatePage(targetPage, delta);
        workingRotationMap = applyRotationChange(workingRotationMap, targetPage, delta);
      };
      ocrRunRef.current = {
        targetPages,
        options: runOptions,
        currentIndex: startIndex,
        continuousRotation,
        lastHigh,
        threshold: continuousRotationThresholdValue,
        highConfidenceRotations,
      };

      for (let index = startIndex; index < targetPages.length; index += 1) {
        const pageNumber = targetPages[index];
        if (ocrRunRef.current) {
          ocrRunRef.current.currentIndex = index;
        }
        if (abortController.signal.aborted) {
          throw new Error("OCR処理が中断されました");
        }

        setOcrProgress({
          current: index + 1,
          total,
          page: pageNumber,
        });

        try {
          const baseScale = runOptions.forceAll ? OCR_AUTO_SCALE : 1;
          const detectWithScale = (scale: number) =>
            detectOrientationForPage(state.pdfDoc, pageNumber, {
              fetcher,
              scale,
            });

          let suggestion: OrientationSuggestion;
          try {
            suggestion = await detectWithScale(baseScale);
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (baseScale > OCR_RETRY_SCALE && message.includes("HTTP 504")) {
              suggestion = await detectWithScale(OCR_RETRY_SCALE);
            } else {
              throw error;
            }
          }
          setOcrSuggestion(suggestion);

          if (suggestion.rotation === null) {
            continue;
          }

          applyRotationToPage(pageNumber, suggestion.rotation);

          const confidenceValue = suggestion.likelihood ?? suggestion.confidence;
          if (continuousRotation && confidenceValue >= continuousRotationThresholdValue) {
            highConfidenceRotations[pageNumber] = suggestion.rotation;
            if (lastHigh && lastHigh.rotation === suggestion.rotation) {
              const startPage = lastHigh.page + 1;
              const endPage = pageNumber - 1;
              if (startPage <= endPage) {
                let hasConflict = false;
                for (let checkPage = startPage; checkPage <= endPage; checkPage += 1) {
                  const recorded = highConfidenceRotations[checkPage];
                  if (recorded !== undefined && recorded !== suggestion.rotation) {
                    hasConflict = true;
                    break;
                  }
                }
                if (!hasConflict) {
                  for (let fillPage = startPage; fillPage <= endPage; fillPage += 1) {
                    if (!targetPagesSet.has(fillPage)) continue;
                    applyRotationToPage(fillPage, suggestion.rotation);
                  }
                }
              }
            }
            lastHigh = { page: pageNumber, rotation: suggestion.rotation };
            if (ocrRunRef.current) {
              ocrRunRef.current.lastHigh = lastHigh;
              ocrRunRef.current.highConfidenceRotations = highConfidenceRotations;
            }
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : "OCRの推定に失敗しました";
          errors.push({ page: pageNumber, message: text });
        }
      }

      if (errors.length > 0) {
        setOcrError(`${errors.length}ページでOCRに失敗しました（例: ${errors[0].page}ページ）`);
      }
      if (total > 1) {
        const failureSuffix = errors.length > 0 ? `（失敗 ${errors.length}ページ）` : "";
        setOcrCompleteMessage(`${total}ページの向き推定が完了しました${failureSuffix}`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "OCRの推定に失敗しました";
      const aborted =
        text.includes("中断")
        || (error instanceof DOMException && error.name === "AbortError");
      if (!aborted) {
        setOcrError(text);
      } else if (ocrRunRef.current && total > 1) {
        setOcrResumeInfo({ ...ocrRunRef.current });
      }
    } finally {
      setOcrLoading(false);
      setOcrProgress(null);
      ocrRunRef.current = null;
    }
  }, [continuousRotationEnabled, health, rotatePage, selectedPages, state.numPages, state.pdfDoc, state.rotationMap]);

  const handleAbortOcr = useCallback(() => {
    if (!ocrLoading || !ocrProgress || ocrProgress.total <= 1) return;
    ocrAbortRef.current?.abort();
    if (ocrRunRef.current) {
      setOcrResumeInfo({ ...ocrRunRef.current });
    }
  }, [ocrLoading, ocrProgress]);

  const handleResumeOcr = useCallback(() => {
    if (!ocrResumeInfo) return;
    void handleDetectOrientation({ resume: ocrResumeInfo });
  }, [handleDetectOrientation, ocrResumeInfo]);

  useEffect(() => {
    if (!state.pdfDoc || state.status !== "ready") {
      autoOcrDocRef.current = null;
      return;
    }
    if (health?.ocrEnabled !== true) {
      return;
    }
    if (autoOcrDocRef.current === state.pdfDoc) {
      return;
    }
    autoOcrDocRef.current = state.pdfDoc;
    void handleDetectOrientation({ forceAll: true });
  }, [handleDetectOrientation, health?.ocrEnabled, state.pdfDoc, state.status]);

  const suggestionText =
    ocrSuggestion && state.pdfDoc
      ? ocrSuggestion.rotation === null
        ? "向きを特定できませんでした"
        : `${ocrSuggestion.rotation}° / 尤度 ${(ocrSuggestion.likelihood ?? ocrSuggestion.confidence).toFixed(2)}`
      : "未推定";

  const toastText = ocrError ?? message;
  const versionText = health?.version ? `v${health.version}` : "v--";
  const selectedSet = useMemo(() => new Set(selectedPages), [selectedPages]);
  const selectionLabel = selectedPages.length > 0 ? `${selectedPages.length}ページ選択中` : "未選択";

  return (
    <div className="app">
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
                {renderState === "rendering" && <span className="pill pill--render">サムネイル生成中...</span>}
              </div>
              <div className="viewer__meta">
                <span className="meta-badge">総ページ {state.numPages || "--"}</span>
                <span className="meta-badge">選択 {selectionLabel}</span>
              </div>
            </div>
            <p className="hint">クリック/ドラッグで複数選択。Ctrl/Cmd + ←/→/↑/↓ で回転。ダブルクリックで拡大。</p>
            <div
              className={`viewer__grid${dragging ? " viewer__grid--dragging" : ""}`}
              ref={viewerGridRef}
              onDragEnter={handleDragEnter}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {dragging && (
                <div className="viewer__drop-overlay">
                  <span>PDFをドロップして読み込み</span>
                </div>
              )}
              {!state.pdfDoc && !dragging && <div className="placeholder">PDFを読み込むとここに表示されます</div>}
              {state.pdfDoc && (
                <div
                  className="thumb-grid"
                  role="list"
                  aria-label="ページ一覧"
                  style={{
                    paddingTop: thumbGridWindow.paddingTop,
                    paddingBottom: thumbGridWindow.paddingBottom,
                  }}
                >
                  {thumbGridWindow.pageNumbers.map((pageNumber, index) => {
                    const isSelected = selectedSet.has(pageNumber);
                    const rotation = state.rotationMap[pageNumber] ?? 0;
                    return (
                      <button
                        type="button"
                        key={pageNumber}
                        className={`thumb-card${isSelected ? " is-selected" : ""}${rotation !== 0 ? " is-rotated" : ""}`}
                        aria-pressed={isSelected}
                        aria-label={`ページ ${pageNumber}`}
                        disabled={state.status !== "ready"}
                        onPointerDown={handleThumbPointerDown(pageNumber, isSelected)}
                        onPointerEnter={handleThumbPointerEnter(pageNumber)}
                        onDoubleClick={handleThumbDoubleClick(pageNumber)}
                        ref={index === 0 ? measureThumbCardRef : undefined}
                      >
                        <div className="thumb-canvas">
                          <canvas
                            ref={setThumbCanvas(pageNumber)}
                          />
                        </div>
                        <div className="thumb-meta">
                          <span>p.{pageNumber}</span>
                          {rotation !== 0 && <span className="pill pill--ghost">{rotation}°</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="viewer__actions">
              <button
                className="save-btn"
                onClick={() => handleSave()}
                disabled={!canSave}
              >
                適用して保存 (Ctrl+S)
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages([])}
                disabled={selectedPages.length === 0 || state.status !== "ready"}
              >
                選択解除
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
              <p className="label">OCR向き推定</p>
              <div className="button-row">
                <button
                  onClick={handleDetectOrientation}
                  disabled={state.status !== "ready" || ocrLoading || (health?.ocrEnabled === false)}
                >
                  {ocrLoading ? "推定中..." : "向き推定"}
                </button>
                {ocrLoading && (ocrProgress?.total ?? 0) > 1 && (
                  <button type="button" onClick={handleAbortOcr}>
                    処理中止
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResumeOcr}
                  disabled={!ocrResumeInfo || ocrLoading || state.status !== "ready" || (health?.ocrEnabled === false)}
                >
                  処理再開
                </button>
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={continuousRotationEnabled}
                  onChange={(event) => setContinuousRotationEnabled(event.target.checked)}
                  disabled={ocrLoading}
                />
                連続回転を有効化
                <span className="toggle-row__field">
                  <span className="label inline">基準</span>
                  <input
                    className="number-input number-input--compact"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={continuousRotationThreshold}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setContinuousRotationThreshold(Math.min(1, Math.max(0, next)));
                    }}
                    disabled={ocrLoading}
                  />
                </span>
              </label>
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
                    PDF読み込み時に全ページを自動推定し、必要なら回転を適用します。基準値を設定して連続回転を有効化すると、高確度で同じ方向へ回転するページの間が全て同じ方向に自動回転します。
                  </p>
                )}
                {ocrSuggestion && <p className="hint">推定対象ページ: {ocrSuggestion.page}</p>}
                {!ocrLoading && ocrCompleteMessage && <p className="hint">{ocrCompleteMessage}</p>}
                {ocrError && <span className="error-text">{ocrError}</span>}
              </div>
            </div>
            <div className="controls__group">
              <p className="label">回転</p>
              <div className="button-row">
                <button onClick={() => rotateSelectedPages(-90)} disabled={state.status !== "ready" || selectedPages.length === 0}>
                  選択を-90°
                </button>
                <button onClick={() => rotateSelectedPages(90)} disabled={state.status !== "ready" || selectedPages.length === 0}>
                  選択を+90°
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
          <div className="modal__card" ref={helpModalRef}>
            <div className="modal__header">
              <h2>ヘルプ</h2>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="閉じる">
                ×
              </button>
            </div>
            <div className="modal__body">
              <p className="hint">
                PDFはブラウザ内で処理します。PDF読み込み時の自動OCRと手動実行時のみ、ページ画像をサーバへ送信します。
              </p>
              <p className="label">ショートカット</p>
              <ul className="help-list">
                <li>Ctrl/Cmd + →: +90° 回転</li>
                <li>Ctrl/Cmd + ←: -90° 回転</li>
                <li>Ctrl/Cmd + ↑/↓: 180° 回転</li>
                <li>Ctrl/Cmd + S: 回転を適用して保存</li>
                <li>Esc: 選択解除</li>
                <li>ダブルクリック: 拡大表示</li>
              </ul>
            </div>
          </div>
        </div>
      )}
      {previewPage !== null && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="プレビュー"
          onDragEnter={handleDragEnter}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="modal__backdrop" onClick={() => setPreviewPage(null)} />
          <div className="modal__card modal__card--preview" ref={previewModalRef}>
            <div className="modal__header">
              <h2>プレビュー p.{previewPage}</h2>
              <button type="button" onClick={() => setPreviewPage(null)} aria-label="閉じる">
                ×
              </button>
            </div>
            <div className="modal__body preview-body">
              {renderState === "rendering" && (
                <span className="pill pill--render" role="status" aria-label="描画中">
                  描画中...
                </span>
              )}
              <div className="preview-canvas">
                <canvas ref={previewCanvasRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
