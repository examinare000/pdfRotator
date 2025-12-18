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

type RecognizeResult = { data?: { text?: string; lines?: unknown[] } };

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

const MAX_SKEW_DEGREES = 15;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const getBaselineSkewDegrees = (baseline: unknown): number | null => {
  const record = baseline && typeof baseline === "object" ? (baseline as Record<string, unknown>) : null;
  if (!record) return null;

  const x0 = toFiniteNumber(record.x0);
  const y0 = toFiniteNumber(record.y0);
  const x1 = toFiniteNumber(record.x1);
  const y1 = toFiniteNumber(record.y1);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;

  const degrees = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  const normalized = ((degrees % 180) + 180) % 180;
  const skew = normalized > 90 ? 180 - normalized : normalized;
  return skew;
};

const countRecognizedCharactersFromLines = (lines: unknown): number | null => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  let total = 0;
  for (const rawLine of lines) {
    const line = rawLine && typeof rawLine === "object" ? (rawLine as Record<string, unknown>) : null;
    if (!line) continue;

    const text = typeof line.text === "string" ? line.text : undefined;
    const skew = getBaselineSkewDegrees(line.baseline);

    if (skew !== null && skew > MAX_SKEW_DEGREES) {
      continue;
    }

    total += countRecognizedCharacters(text);
  }

  return total;
};

const countRecognizedCharactersFromResult = (data: unknown): number => {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!record) return 0;

  const countedFromLines = countRecognizedCharactersFromLines(record.lines);
  if (countedFromLines !== null) {
    if (countedFromLines > 0) return countedFromLines;
    const fallbackText = typeof record.text === "string" ? record.text : undefined;
    return countRecognizedCharacters(fallbackText);
  }

  const text = typeof record.text === "string" ? record.text : undefined;
  return countRecognizedCharacters(text);
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
      const count = countRecognizedCharactersFromResult(data);
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
        // eslint-disable-next-line no-console
        console.warn("text_sample_extraction_failed", error);
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
