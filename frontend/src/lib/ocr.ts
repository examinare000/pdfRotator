import { renderPageToCanvas, type PdfDocumentProxy } from "./pdf";
import type { Rotation } from "./rotation";

export type OrientationSuggestion = {
  rotation: Rotation | null;
  confidence: number;
  processingMs?: number;
  textSample?: string;
};

type RequestOptions = {
  fetcher?: typeof fetch;
};

type DetectOptions = RequestOptions & {
  createCanvas?: () => HTMLCanvasElement;
  scale?: number;
};

const extractBase64FromDataUrl = (dataUrl: string): string => {
  if (!dataUrl || !dataUrl.includes(",")) {
    return "";
  }
  const [, base64] = dataUrl.split(",", 2);
  return base64?.trim() ?? "";
};

export const requestOrientationDetection = async (
  imageBase64: string,
  options: RequestOptions = {}
): Promise<OrientationSuggestion> => {
  const fetcher = options.fetcher ?? fetch;
  if (!imageBase64) {
    throw new Error("OCRの推定に失敗しました: 画像データが空です");
  }

  let response: Response;
  try {
    response = await fetcher("/api/ocr/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64 }),
    });
  } catch (error) {
    throw new Error("OCRの推定に失敗しました: ネットワークエラーが発生しました");
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    const message = body?.message ?? `HTTP ${response.status} エラー`;
    throw new Error(`OCRの推定に失敗しました: ${message}`);
  }

  return {
    rotation: body?.rotation ?? null,
    confidence: body?.confidence ?? 0,
    processingMs: body?.processingMs,
    textSample: body?.textSample,
  };
};

export const detectOrientationForPage = async (
  doc: PdfDocumentProxy,
  pageNumber: number,
  options: DetectOptions = {}
): Promise<OrientationSuggestion & { page: number }> => {
  if (!doc) {
    throw new Error("PDFが読み込まれていません");
  }
  if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error("ページ番号が不正です");
  }

  const page = await doc.getPage(pageNumber);
  const canvas = options.createCanvas ? options.createCanvas() : document.createElement("canvas");
  const scale = options.scale ?? 1;

  await renderPageToCanvas(page as any, canvas, { scale, rotation: 0 });
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = extractBase64FromDataUrl(dataUrl);
  if (!base64) {
    throw new Error("ページ画像の取得に失敗しました");
  }

  const suggestion = await requestOrientationDetection(base64, { fetcher: options.fetcher });
  return { ...suggestion, page: pageNumber };
};
