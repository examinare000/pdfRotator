import { useCallback, useState } from "react";
import type { PdfDocumentProxy } from "../lib/pdf";
import { applyRotationChange, clampPageNumber, type PageRotationMap } from "../lib/rotation";

export type ViewerStatus = "idle" | "ready";

export type ViewerState = {
  status: ViewerStatus;
  pdfDoc: PdfDocumentProxy | null;
  numPages: number;
  currentPage: number;
  rotationMap: PageRotationMap;
  zoom: number;
};

export type ViewerControls = {
  loadDocument: (doc: PdfDocumentProxy) => void;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  rotateCurrentPage: (delta: number) => void;
  setZoom: (zoom: number) => void;
  reset: () => void;
};

const INITIAL_STATE: ViewerState = {
  status: "idle",
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  rotationMap: {},
  zoom: 1,
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

export const useViewerState = (): { state: ViewerState } & ViewerControls => {
  const [state, setState] = useState<ViewerState>(INITIAL_STATE);

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
    });
  }, []);

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
    setPage,
    nextPage,
    prevPage,
    rotateCurrentPage,
    setZoom,
    reset,
  };
};
