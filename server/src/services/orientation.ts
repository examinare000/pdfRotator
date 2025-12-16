import sharp from "sharp";
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

type RecognizeResult = { data?: { text?: string } };

type RecognizeFn = (buffer: Buffer) => Promise<RecognizeResult>;

type RotateFn = (buffer: Buffer, degrees: Exclude<Orientation, null>) => Promise<Buffer>;

export type CreateTesseractDetectorOptions = {
  recognize?: RecognizeFn;
  rotate?: RotateFn;
};

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

const countRecognizedCharacters = (text: string | undefined): number => {
  if (!text) {
    return 0;
  }
  return text.replace(/\s+/g, "").length;
};

const chooseBestOrientation = (
  counts: Array<{ orientation: Exclude<Orientation, null>; count: number; text?: string }>
): OrientationResult => {
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return { rotation: null, confidence: 0 };
  }

  const best = counts.reduce((currentBest, item) => {
    if (item.count > currentBest.count) {
      return item;
    }
    if (item.count === currentBest.count && item.orientation < currentBest.orientation) {
      return item;
    }
    return currentBest;
  }, counts[0]);

  const confidence = best.count / total;
  return { rotation: best.orientation, confidence, textSample: normalizeTextSample(best.text) };
};

const detectWithSweep = async (
  buffer: Buffer,
  signal: AbortSignal | undefined,
  recognizeFn: RecognizeFn,
  rotateFn: RotateFn
): Promise<OrientationResult> => {
  const candidates: Array<Exclude<Orientation, null>> = [0, 90, 180, 270];
  const counts: Array<{ orientation: Exclude<Orientation, null>; count: number; text?: string }> = [];

  for (const orientation of candidates) {
    if (signal?.aborted) {
      throw new Error("OCR処理が中断されました");
    }

    try {
      const rotatedBuffer = await rotateFn(buffer, orientation);
      const { data } = await recognizeFn(rotatedBuffer);
      const text = data?.text;
      const count = countRecognizedCharacters(text);
      counts.push({ orientation, count, text });
    } catch (error) {
      counts.push({ orientation, count: 0, text: undefined });
      if (process.env.NODE_ENV !== "test") {
        // eslint-disable-next-line no-console
        console.warn("orientation_detect_failed", error);
      }
    }
  }

  return chooseBestOrientation(counts);
};

const detectWithTesseract = async (
  buffer: Buffer,
  signal: AbortSignal | undefined
): Promise<OrientationResult> => {
  if (signal?.aborted) {
    throw new Error("OCR処理が中断されました");
  }
  const { data } = await Tesseract.detect(buffer);
  const rotation = normalizeRotation(data?.orientation_degrees ?? null);
  const confidence = data?.orientation_confidence ?? 0;

  let textSample: string | undefined;
  try {
    const targetBuffer =
      rotation && rotation !== 0 ? await sharp(buffer).rotate(rotation).toBuffer() : buffer;
    const ocrResult = await Tesseract.recognize(targetBuffer);
    textSample = normalizeTextSample(ocrResult.data?.text);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn("text_sample_extraction_failed", error);
    }
  }

  return { rotation, confidence, textSample };
};

export const createTesseractDetector = ({
  recognize,
  rotate,
}: CreateTesseractDetectorOptions = {}): OrientationDetector => {
  const recognizeFn: RecognizeFn =
    recognize ??
    (async (buffer: Buffer) => {
      return await Tesseract.recognize(buffer);
    });

  const rotateFn: RotateFn =
    rotate ??
    (async (buffer: Buffer, degrees: Exclude<Orientation, null>) => {
      if (degrees === 0) {
        return buffer;
      }
      const rotated = await sharp(buffer).rotate(degrees).toBuffer();
      return rotated;
    });

  const hasCustomStrategy = Boolean(recognize || rotate);

  return {
    async detect({ buffer, signal }) {
      if (!hasCustomStrategy) {
        try {
          return await detectWithTesseract(buffer, signal);
        } catch (error) {
          if (process.env.NODE_ENV !== "test") {
            // eslint-disable-next-line no-console
            console.warn("orientation_detect_failed", error);
          }
        }
      }

      return await detectWithSweep(buffer, signal, recognizeFn, rotateFn);
    },
  };
};
