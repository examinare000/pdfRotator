export type PdfPageViewport = {
  width: number;
  height: number;
};

export type PdfPageProxy = {
  getViewport: (params: { scale: number; rotation?: number }) => PdfPageViewport;
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfPageViewport }) => {
    promise: Promise<unknown>;
  };
};

export type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
};

export type PdfJsLike = {
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocumentProxy> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

export type LoadOptions = {
  workerSrc?: string;
  baseUrl?: string;
};

export const resolveWorkerSrc = (baseUrl?: string): string => {
  const base =
    baseUrl ??
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error import.meta may not exist in tests
    (typeof import.meta !== "undefined" ? import.meta.env?.BASE_URL : "/") ??
    "/";
  const normalizedBase = base === "" ? "/" : base;
  const trimmed = normalizedBase.endsWith("/") ? normalizedBase.slice(0, -1) : normalizedBase;
  const safeBase = trimmed === "" ? "/" : trimmed;
  if (safeBase === "/") {
    return "/pdf.worker.js";
  }
  return `${safeBase}/pdf.worker.js`;
};

export const createPdfLoader = (pdfjs: PdfJsLike) => {
  return {
    async loadFromArrayBuffer(buffer: ArrayBuffer, options?: LoadOptions): Promise<PdfDocumentProxy> {
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("PDFデータが空です");
      }

      const workerSrc = options?.workerSrc ?? resolveWorkerSrc(options?.baseUrl);
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      }

      const task = pdfjs.getDocument({ data: buffer });
      return await task.promise;
    },
  };
};

export type RenderOptions = {
  scale: number;
  rotation?: number;
  maxCanvasWidth?: number;
  maxCanvasHeight?: number;
};

export const renderPageToCanvas = async (
  page: PdfPageProxy,
  canvas: HTMLCanvasElement,
  options: RenderOptions
): Promise<PdfPageViewport> => {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) {
    throw new Error("キャンバスのコンテキストが取得できません");
  }

  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error("スケールは正の数で指定してください");
  }

  const rotation = options.rotation ?? 0;
  const initialViewport = page.getViewport({
    scale: options.scale,
    rotation,
  });

  const widthLimit = Number.isFinite(options.maxCanvasWidth) ? options.maxCanvasWidth : Infinity;
  const heightLimit = Number.isFinite(options.maxCanvasHeight) ? options.maxCanvasHeight : Infinity;
  const clampRatio = Math.min(
    1,
    widthLimit / initialViewport.width,
    heightLimit / initialViewport.height
  );

  const effectiveScale = options.scale * clampRatio;
  const viewport =
    clampRatio < 1
      ? page.getViewport({ scale: effectiveScale, rotation })
      : initialViewport;

  // Canvasは整数ピクセルに設定する（PDF.jsの描画サイズに合わせる）
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
  return { width: canvas.width, height: canvas.height };
};
