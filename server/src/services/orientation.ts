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

export const createTesseractDetector = (): OrientationDetector => {
  return {
    async detect({ buffer }) {
      const { data } = await Tesseract.detect(buffer);
      const rotation = normalizeRotation(data?.orientation_degrees ?? null);
      const confidence = data?.orientation_confidence ?? 0;

      return {
        rotation,
        confidence,
      };
    },
  };
};
