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

export type RenderPageToPngOptions = {
  scale?: number;
  rotation?: number;
  createCanvas?: () => HTMLCanvasElement;
  // renderer の差し替えを許可することでテスト容易性を高める
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

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_ENDPOINT = "/api/ocr/orientation";

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

  const res = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, threshold }),
  });

  const data = res?.ok ? await res.json() : null;

  if (!res?.ok || !data?.success) {
    const fallback = "OCRの呼び出しに失敗しました";
    const message =
      data?.message && typeof data.message === "string"
        ? `${fallback}: ${data.message}`
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
