import { useCallback, useState } from "react";
import type { PdfDocumentProxy, PdfLoader } from "../lib/pdf";
import { applyRotationChange, clampPageNumber, type PageRotationMap } from "../lib/rotation";

export type ViewerStatus = "idle" | "loading" | "ready" | "error";

export type ViewerState = {
  status: ViewerStatus;
  pdfDoc: PdfDocumentProxy | null;
  numPages: number;
  currentPage: number;
  rotationMap: PageRotationMap;
  zoom: number;
  errorMessage: string | null;
};

export type ViewerControls = {
  loadDocument: (doc: PdfDocumentProxy) => void;
  loadFromArrayBuffer: (buffer: ArrayBuffer, options?: { workerSrc?: string }) => Promise<void>;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  rotateCurrentPage: (delta: number) => void;
  setZoom: (zoom: number) => void;
  reset: () => void;
};

type UseViewerStateOptions = {
  loader?: PdfLoader;
};

const INITIAL_STATE: ViewerState = {
  status: "idle",
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  rotationMap: {},
  zoom: 1,
  errorMessage: null,
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const clampZoom = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("ズームは正の数で指定してください");
  }
  if (value < MIN_ZOOM) return MIN_ZOOM;
  if (value > MAX_ZOOM) return MAX_ZOOM;
  return value;
};

export const useViewerState = (
  options: UseViewerStateOptions = {}
): { state: ViewerState } & ViewerControls => {
  const [state, setState] = useState<ViewerState>(INITIAL_STATE);
  const loader = options.loader;

  const loadDocument = useCallback((doc: PdfDocumentProxy) => {
    if (!doc || !Number.isFinite(doc.numPages) || doc.numPages < 1) {
      throw new Error("総ページ数は1以上のPDFのみ読み込めます");
    }
    setState({
      status: "ready",
      pdfDoc: doc,
      numPages: doc.numPages,
      currentPage: 1,
      rotationMap: {},
      zoom: 1,
      errorMessage: null,
    });
  }, []);

  const loadFromArrayBuffer = useCallback(
    async (buffer: ArrayBuffer, extraOptions?: { workerSrc?: string }) => {
      if (!loader) {
        throw new Error("PDFローダーが設定されていません");
      }
      setState((prev) => ({ ...prev, status: "loading", errorMessage: null }));
      try {
        const doc = await loader.loadFromArrayBuffer(buffer, extraOptions);
        loadDocument(doc);
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "PDFの読み込みに失敗しました";
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: message,
          pdfDoc: null,
          numPages: 0,
          currentPage: 1,
          rotationMap: {},
        }));
      }
    },
    [loader, loadDocument]
  );

  const setPage = useCallback((page: number) => {
    setState((prev) => {
      if (prev.numPages < 1) return prev;
      return { ...prev, currentPage: clampPageNumber(page, prev.numPages) };
    });
  }, []);

  const nextPage = useCallback(() => {
    setState((prev) => {
      if (prev.numPages < 1) return prev;
      return { ...prev, currentPage: clampPageNumber(prev.currentPage + 1, prev.numPages) };
    });
  }, []);

  const prevPage = useCallback(() => {
    setState((prev) => {
      if (prev.numPages < 1) return prev;
      return { ...prev, currentPage: clampPageNumber(prev.currentPage - 1, prev.numPages) };
    });
  }, []);

  const rotateCurrentPage = useCallback((delta: number) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const nextRotationMap = applyRotationChange(prev.rotationMap, prev.currentPage, delta);
      return { ...prev, rotationMap: nextRotationMap };
    });
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setState((prev) => ({ ...prev, zoom: clampZoom(zoom) }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    loadDocument,
    loadFromArrayBuffer,
    setPage,
    nextPage,
    prevPage,
    rotateCurrentPage,
    setZoom,
    reset,
  };
};
