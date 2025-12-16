import Tesseract from "tesseract.js";

export type Orientation = 0 | 90 | 180 | 270 | null;

export type OrientationResult = {
  rotation: Orientation;
  confidence: number;
  textSample?: string;
};

export type OrientationInput = {
  buffer: Buffer;
  mimeType?: string;
  signal?: AbortSignal;
};

export interface OrientationDetector {
  detect: (input: OrientationInput) => Promise<OrientationResult>;
}

const normalizeRotation = (degrees: number | null | undefined): Orientation => {
  if (degrees === null || degrees === undefined || Number.isNaN(degrees)) {
    return null;
  }
  const normalized = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized as Orientation;
  }
  return null;
};

const normalizeTextSample = (text: string | null | undefined): string | undefined => {
  if (!text) {
    return undefined;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 120);
};

export const createTesseractDetector = (): OrientationDetector => {
  return {
    async detect({ buffer }) {
      const { data } = await Tesseract.detect(buffer);
      const rotation = normalizeRotation(data?.orientation_degrees ?? null);
      const confidence = data?.orientation_confidence ?? 0;
      let textSample: string | undefined;

      try {
        const ocrResult = await Tesseract.recognize(buffer, "eng");
        textSample = normalizeTextSample(ocrResult.data?.text);
      } catch (error) {
        // Tesseractのテキスト抽出に失敗しても向き判定は返す
        if (process.env.NODE_ENV !== "test") {
          // eslint-disable-next-line no-console
          console.warn("text_sample_extraction_failed", error);
        }
      }

      return {
        rotation,
        confidence,
        textSample,
      };
    },
  };
};
