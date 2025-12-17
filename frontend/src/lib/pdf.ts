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

export type PdfLoader = {
  loadFromArrayBuffer: (buffer: ArrayBuffer, options?: LoadOptions) => Promise<PdfDocumentProxy>;
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
    (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ??
    "/";
  const normalizedBase = base === "" ? "/" : base;
  const trimmed = normalizedBase.endsWith("/") ? normalizedBase.slice(0, -1) : normalizedBase;
  const safeBase = trimmed === "" ? "/" : trimmed;
  return safeBase === "/" ? "/pdf.worker.js" : `${safeBase}/pdf.worker.js`;
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

      try {
        const task = pdfjs.getDocument({ data: buffer });
        return await task.promise;
      } catch (error) {
        throw new Error("PDFの読み込みに失敗しました", { cause: error as Error });
      }
    },
  };
};

export type RenderOptions = {
  scale: number;
  rotation?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxCanvasWidth?: number;
  maxCanvasHeight?: number;
};

export const DEFAULT_MAX_CANVAS_DIMENSION = 1600;

const assertPositiveNumber = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} は正の数で指定してください`);
  }
};

const clampViewport = (
  viewport: PdfPageViewport,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number; scale: number } => {
  assertPositiveNumber(maxWidth, "maxWidth");
  assertPositiveNumber(maxHeight, "maxHeight");
  assertPositiveNumber(viewport.width, "viewport.width");
  assertPositiveNumber(viewport.height, "viewport.height");

  const widthScale = viewport.width > maxWidth ? maxWidth / viewport.width : 1;
  const heightScale = viewport.height > maxHeight ? maxHeight / viewport.height : 1;
  const scale = Math.min(widthScale, heightScale);
  const appliedScale = scale < 1 ? scale : 1;
  return {
    width: viewport.width * appliedScale,
    height: viewport.height * appliedScale,
    scale: appliedScale,
  };
};

const resolveLimit = (value?: number): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
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
  const baseViewport = page.getViewport({
    scale: options.scale,
    rotation,
  });

  const maxWidth =
    resolveLimit(options.maxWidth ?? options.maxCanvasWidth) ?? DEFAULT_MAX_CANVAS_DIMENSION;
  const maxHeight =
    resolveLimit(options.maxHeight ?? options.maxCanvasHeight) ?? DEFAULT_MAX_CANVAS_DIMENSION;
  const clamped = clampViewport(baseViewport, maxWidth, maxHeight);
  const viewport =
    clamped.scale < 1
      ? page.getViewport({ scale: options.scale * clamped.scale, rotation })
      : baseViewport;

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
  return { width: viewport.width, height: viewport.height };
};

export type PageCache<T> = {
  get: (pageNumber: number) => T | undefined;
  set: (pageNumber: number, value: T) => void;
  has: (pageNumber: number) => boolean;
  keys: () => number[];
  clear: () => void;
  size: () => number;
};

export const createPageCache = <T>(maxEntries = 3): PageCache<T> => {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("キャッシュの上限は1以上の整数で指定してください");
  }
  const cache = new Map<number, T>();

  const touch = (pageNumber: number, value: T) => {
    cache.delete(pageNumber);
    cache.set(pageNumber, value);
  };

  return {
    get(pageNumber) {
      const value = cache.get(pageNumber);
      if (value !== undefined) {
        touch(pageNumber, value);
      }
      return value;
    },
    set(pageNumber, value) {
      touch(pageNumber, value);
      if (cache.size > maxEntries) {
        const first = cache.keys().next();
        if (!first.done) cache.delete(first.value);
      }
    },
    has(pageNumber) {
      return cache.has(pageNumber);
    },
    keys() {
      return Array.from(cache.keys());
    },
    clear() {
      cache.clear();
    },
    size() {
      return cache.size;
    },
  };
};
