import express from "express";
import { RequestError } from "./errors";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, MAX_UPLOAD_MB } from "./config";

export const isBase64 = (value: string): boolean => {
  const trimmed = value.trim();
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
};

export const parseThreshold = (raw: unknown): number => {
  if (raw === undefined || raw === null || raw === "") {
    return 0.6;
  }
  const threshold = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new RequestError(400, "invalid_threshold", "threshold は 0 以上 1 以下の数値で指定してください");
  }
  return threshold;
};

export const promiseWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RequestError(504, "ocr_timeout", "OCR処理がタイムアウトしました"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const ensureUsableBuffer = (buffer: Buffer | undefined): Buffer => {
  if (!buffer || buffer.length === 0) {
    throw new RequestError(
      400,
      "empty_image",
      "アップロードされた画像が空のようです。別のファイルで再度お試しください。",
      { retryable: true }
    );
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new RequestError(
      413,
      "file_too_large",
      `ファイルサイズが大きすぎます。${MAX_UPLOAD_MB}MB以内のPNG/JPEGを選び直してください。`,
      { retryable: true }
    );
  }

  return buffer;
};

export const extractBase64 = (raw: string): Buffer => {
  const trimmed = raw.trim();
  const content = trimmed.includes(",") ? trimmed.split(",").pop() ?? "" : trimmed;
  if (!content || !isBase64(content)) {
    throw new RequestError(
      400,
      "invalid_image",
      "画像を読み取れませんでした。別の画像で再度お試しください。",
      { retryable: true }
    );
  }
  const buffer = Buffer.from(content, "base64");
  return ensureUsableBuffer(buffer);
};

export const extractImagePayload = (req: express.Request) => {
  if (req.file) {
    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      throw new RequestError(400, "unsupported_mime", "対応していない画像形式です");
    }
    return { buffer: ensureUsableBuffer(req.file.buffer), mimeType: req.file.mimetype };
  }

  const base64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : undefined;
  if (base64) {
    return { buffer: extractBase64(base64), mimeType: "image/png" };
  }

  throw new RequestError(400, "image_required", "画像データが必要です");
};
