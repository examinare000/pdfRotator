import { renderPageToCanvas, type PdfPageProxy } from "./pdf";

export type Orientation = 0 | 90 | 180 | 270 | null;

export type OrientationResponse = {
  success: true;
  rotation: Orientation;
  confidence: number;
  processingMs: number;
  textSample?: string;
};

export type OrientationRequestOptions = {
  threshold?: number;
  fetcher?: typeof fetch;
  endpoint?: string;
};

export type OrientationSuggestion = OrientationResponse & {
  page: number;
  viewport: { width: number; height: number };
  imageBase64?: string;
};

export type RenderPageToPngOptions = {
  scale?: number;
  rotation?: number;
  createCanvas?: () => HTMLCanvasElement;
  render?: (
    page: PdfPageProxy,
    canvas: HTMLCanvasElement,
    options: { scale: number; rotation?: number }
  ) => Promise<{ width: number; height: number }>;
};

export type DetectOrientationParams = {
  page: PdfPageProxy;
  threshold?: number;
  scale?: number;
  rotation?: number;
  createCanvas?: () => HTMLCanvasElement;
  render?: RenderPageToPngOptions["render"];
  request?: (payload: { imageBase64: string; threshold: number }) => Promise<OrientationResponse>;
};

export type DetectOrientationForPageOptions = OrientationRequestOptions & {
  scale?: number;
  rotation?: number;
};

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_ENDPOINT = "/api/ocr/orientation";

const safeReadJson = async (res: unknown): Promise<unknown | null> => {
  if (!res || typeof res !== "object") {
    return null;
  }

  const maybeResponse = res as { json?: () => Promise<unknown> };
  if (typeof maybeResponse.json === "function") {
    try {
      return await maybeResponse.json();
    } catch {
      return null;
    }
  }

  return null;
};

export const renderPageToPng = async (
  page: PdfPageProxy,
  options: RenderPageToPngOptions = {}
): Promise<{ dataUrl: string; viewport: { width: number; height: number } }> => {
  const canvas = options.createCanvas?.() ?? document.createElement("canvas");
  const renderFn = options.render ?? renderPageToCanvas;

  const viewport = await renderFn(page, canvas, {
    scale: options.scale ?? 1,
    rotation: options.rotation,
  });

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, viewport };
};

export const requestOrientation = async (
  imageBase64: string,
  options: OrientationRequestOptions = {}
): Promise<OrientationResponse> => {
  const fetcher = options.fetcher ?? fetch;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  let res: Response;
  try {
    res = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, threshold }),
    });
  } catch (error) {
    throw new Error("OCRのリクエストに失敗しました: ネットワークエラー", { cause: error });
  }

  const data = await safeReadJson(res);

  const dataRecord = data && typeof data === "object" ? (data as Record<string, unknown>) : null;

  if (!res?.ok || !dataRecord?.success) {
    const httpStatus =
      typeof res?.status === "number" && res.status > 0 ? ` (HTTP ${res.status})` : "";
    const fallback = `OCRのリクエストに失敗しました${httpStatus}`;
    const message =
      typeof dataRecord?.message === "string"
        ? `${fallback}: ${dataRecord.message}`
        : fallback;
    throw new Error(message);
  }

  return data as OrientationResponse;
};

export const detectOrientationFromPage = async (
  params: DetectOrientationParams
): Promise<{ suggestion: OrientationResponse; imageBase64: string; viewport: { width: number; height: number } }> => {
  const {
    page,
    threshold = DEFAULT_THRESHOLD,
    scale = 1,
    rotation = 0,
    createCanvas,
    render,
    request,
  } = params;

  const { dataUrl, viewport } = await renderPageToPng(page, {
    scale,
    rotation,
    createCanvas,
    render,
  });

  const requester =
    request ??
    ((payload: { imageBase64: string; threshold: number }) =>
      requestOrientation(payload.imageBase64, { threshold: payload.threshold }));

  const suggestion = await requester({ imageBase64: dataUrl, threshold });

  return { suggestion, imageBase64: dataUrl, viewport };
};

export const detectOrientationForPage = async (
  pdfDoc: { numPages: number; getPage: (pageNumber: number) => Promise<PdfPageProxy> },
  pageNumber: number,
  options: DetectOrientationForPageOptions = {}
): Promise<OrientationSuggestion> => {
  if (!pdfDoc) {
    throw new Error("PDFが読み込まれていません");
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    throw new Error("ページ番号が不正です");
  }

  const page = await pdfDoc.getPage(pageNumber);
  const { suggestion, imageBase64, viewport } = await detectOrientationFromPage({
    page,
    threshold: options.threshold,
    scale: options.scale,
    rotation: options.rotation,
    request: (payload) =>
      requestOrientation(payload.imageBase64, {
        threshold: payload.threshold,
        fetcher: options.fetcher,
        endpoint: options.endpoint,
      }),
  });

  return {
    page: pageNumber,
    imageBase64,
    viewport,
    ...suggestion,
  };
};
