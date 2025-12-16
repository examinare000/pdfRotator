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
};

export const createPdfLoader = (pdfjs: PdfJsLike) => {
  return {
    async loadFromArrayBuffer(buffer: ArrayBuffer, options?: LoadOptions): Promise<PdfDocumentProxy> {
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("PDFデータが空です");
      }

      if (options?.workerSrc && pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
      }

      const task = pdfjs.getDocument({ data: buffer });
      return await task.promise;
    },
  };
};

export type RenderOptions = {
  scale: number;
  rotation?: number;
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

  const viewport = page.getViewport({
    scale: options.scale,
    rotation: options.rotation ?? 0,
  });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
  return { width: viewport.width, height: viewport.height };
};
