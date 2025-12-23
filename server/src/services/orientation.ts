import sharp from "sharp";
import Tesseract from "tesseract.js";
import { getAppLogger } from "../logger";

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

type RecognizeResult = {
  data?: {
    text?: string;
    lines?: unknown[];
    words?: unknown[];
    imageSize?: { width?: number; height?: number };
  };
};

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

const MIN_WORD_CONFIDENCE = 60;
const BOTTOM_STRIP_RATIO = 1 / 8;

type BoundingBox = { x0: number; y0: number; x1: number; y1: number };

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const parseBoundingBox = (value: unknown): BoundingBox | null => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) return null;

  const x0 = toFiniteNumber(record.x0);
  const y0 = toFiniteNumber(record.y0);
  const x1 = toFiniteNumber(record.x1);
  const y1 = toFiniteNumber(record.y1);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;

  return { x0, y0, x1, y1 };
};

const resolveImageSize = async (
  data: unknown,
  buffer: Buffer
): Promise<{ width: number; height: number } | null> => {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const imageSize = record?.imageSize && typeof record.imageSize === "object"
    ? (record.imageSize as Record<string, unknown>)
    : null;
  const width = toFiniteNumber(imageSize?.width);
  const height = toFiniteNumber(imageSize?.height);
  if (width !== null && height !== null) {
    return { width, height };
  }

  const metadata = await sharp(buffer).metadata();
  if (metadata.width && metadata.height) {
    return { width: metadata.width, height: metadata.height };
  }
  return null;
};

const collectWordCandidates = (data: unknown): Array<{
  text: string;
  confidence: number | null;
  bbox: BoundingBox | null;
}> => {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!record) return [];

  const rawWords = Array.isArray(record.words)
    ? record.words
    : Array.isArray(record.lines)
      ? record.lines
      : [];

  const words: Array<{ text: string; confidence: number | null; bbox: BoundingBox | null }> = [];
  for (const rawWord of rawWords) {
    const word = rawWord && typeof rawWord === "object" ? (rawWord as Record<string, unknown>) : null;
    if (!word) continue;

    const text = typeof word.text === "string" ? word.text.trim() : "";
    if (!text) continue;

    const confidenceValue = toFiniteNumber(word.confidence);
    const confidence = confidenceValue === null ? null : confidenceValue;
    const bbox = parseBoundingBox(word.bbox);

    words.push({ text, confidence, bbox });
  }

  return words;
};

const splitAlnumTokens = (text: string): string[] => {
  return text.split(/[^A-Za-z0-9]+/).filter(Boolean);
};

const hasDigit = (text: string): boolean => /\d/.test(text);

const isWithinBottomStrip = (bbox: BoundingBox, height: number): boolean => {
  const stripTop = height * (1 - BOTTOM_STRIP_RATIO);
  return bbox.y1 >= stripTop;
};

const normalizeWordConfidence = (confidence: number): number => {
  if (!Number.isFinite(confidence)) return 0;
  if (confidence <= 1) {
    return Math.max(0, Math.min(1, confidence));
  }
  return Math.max(0, Math.min(1, confidence / 100));
};

const isConfidenceAboveThreshold = (confidence: number | null): boolean => {
  if (confidence === null) return false;
  const scaled = confidence <= 1 ? confidence * 100 : confidence;
  return scaled >= MIN_WORD_CONFIDENCE;
};

const scoreBottomStripPageNumberTokens = (
  data: unknown,
  size: { width: number; height: number } | null
): { accuracy: number; bestToken?: string } => {
  if (!size) {
    return { accuracy: 0 };
  }

  const words = collectWordCandidates(data);
  let accuracy = 0;
  let bestToken: string | undefined;
  let bestTokenLength = 0;

  for (const word of words) {
    if (!isConfidenceAboveThreshold(word.confidence)) {
      continue;
    }
    if (!word.bbox || !isWithinBottomStrip(word.bbox, size.height)) {
      continue;
    }

    const tokens = splitAlnumTokens(word.text);
    for (const token of tokens) {
      if (!hasDigit(token)) {
        continue;
      }
      const tokenAccuracy = normalizeWordConfidence(word.confidence ?? 0);
      if (tokenAccuracy > accuracy) {
        accuracy = tokenAccuracy;
        bestToken = token;
        bestTokenLength = token.length;
        continue;
      }
      if (tokenAccuracy === accuracy && token.length > bestTokenLength) {
        bestToken = token;
        bestTokenLength = token.length;
      }
    }
  }

  return { accuracy, bestToken };
};

const detectWithPageNumberSweep = async (
  buffer: Buffer,
  signal: AbortSignal | undefined,
  recognizeFn: RecognizeFn,
  rotateFn: RotateFn
): Promise<OrientationResult> => {
  const candidates: Array<Exclude<Orientation, null>> = [0, 90, 180, 270];
  const counts: Array<{
    orientation: Exclude<Orientation, null>;
    accuracy: number;
    token?: string;
  }> = [];

  for (const orientation of candidates) {
    if (signal?.aborted) {
      throw new Error("OCR処理が中断されました");
    }

    try {
      const rotatedBuffer = await rotateFn(buffer, orientation);
      const { data } = await recognizeFn(rotatedBuffer);
      const size = await resolveImageSize(data, rotatedBuffer);
      const { accuracy, bestToken } = scoreBottomStripPageNumberTokens(data, size);
      counts.push({ orientation, accuracy, token: bestToken });
    } catch (error) {
      counts.push({ orientation, accuracy: 0, token: undefined });
      if (process.env.NODE_ENV !== "test") {
        getAppLogger()?.warn("orientation_detect_failed", { err: error });
      }
    }
  }

  const best = counts.reduce((currentBest, item) => {
    if (item.accuracy > currentBest.accuracy) {
      return item;
    }
    if (item.accuracy === currentBest.accuracy && item.orientation < currentBest.orientation) {
      return item;
    }
    return currentBest;
  }, counts[0]);

  if (best.accuracy <= 0) {
    return { rotation: null, confidence: 0 };
  }
  return {
    rotation: best.orientation,
    confidence: best.accuracy,
    textSample: normalizeTextSample(best.token),
  };
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

  const isTestEnv = process.env.NODE_ENV === "test";
  const textSampleTimeoutMs = isTestEnv
    ? 60_000
    : Number(process.env.OCR_TEXT_SAMPLE_TIMEOUT_MS ?? 800);
  const shouldExtractTextSample =
    (process.env.OCR_TEXT_SAMPLE_ENABLED ?? "true").toLowerCase() === "true" &&
    textSampleTimeoutMs > 0 &&
    Number.isFinite(textSampleTimeoutMs);

  let textSample: string | undefined;
  if (shouldExtractTextSample) {
    try {
      const targetBuffer = rotation ? await sharp(buffer).rotate(rotation).toBuffer() : buffer;
      const ocrPromise = Tesseract.recognize(targetBuffer);
      const result = await Promise.race([
        ocrPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), textSampleTimeoutMs)),
      ]);
      if (result) {
        textSample = normalizeTextSample(result.data?.text);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        getAppLogger()?.warn("text_sample_extraction_failed", { err: error });
      }
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
      const pageNumberResult = await detectWithPageNumberSweep(
        buffer,
        signal,
        recognizeFn,
        rotateFn
      );
      if (pageNumberResult.rotation !== null) {
        return pageNumberResult;
      }

      if (!hasCustomStrategy) {
        try {
          return await detectWithTesseract(buffer, signal);
        } catch (error) {
          if (process.env.NODE_ENV !== "test") {
            getAppLogger()?.warn("orientation_detect_failed", { err: error });
          }
        }
      }

      return pageNumberResult;
    },
  };
};
