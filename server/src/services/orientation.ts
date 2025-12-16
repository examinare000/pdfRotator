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

const countRecognizedCharacters = (text: string | undefined): number => {
  if (!text) {
    return 0;
  }
  return text.replace(/\s+/g, "").length;
};

const chooseBestOrientation = (
  counts: Array<{ orientation: Exclude<Orientation, null>; count: number }>
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
  return { rotation: best.orientation, confidence };
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

  return {
    async detect({ buffer, signal }) {
      const candidates: Array<Exclude<Orientation, null>> = [0, 90, 180, 270];
      const counts: Array<{ orientation: Exclude<Orientation, null>; count: number }> = [];

      for (const orientation of candidates) {
        if (signal?.aborted) {
          throw new Error("OCR処理が中断されました");
        }
        const rotatedBuffer = await rotateFn(buffer, orientation);
        const { data } = await recognizeFn(rotatedBuffer);
        const count = countRecognizedCharacters(data?.text);
        counts.push({ orientation, count });
      }

      return chooseBestOrientation(counts);
    },
  };
};
