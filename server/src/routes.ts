import { Router } from "express";
import type { Logger } from "winston";
import { AppConfig } from "./config";
import { OrientationDetector } from "./services/orientation";
import { uploadMiddleware } from "./middleware";
import { RequestError } from "./errors";
import { extractImagePayload, promiseWithTimeout } from "./utils";

const MIN_LIKELIHOOD = 0.6;

const createRequestId = (): string => {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${now}-${random}`;
};

export const createApiRouter = (config: AppConfig, detector: OrientationDetector): Router => {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: process.env.npm_package_version ?? "dev",
      ocrEnabled: config.ocrEnabled,
    });
  });

  router.post("/ocr/orientation", uploadMiddleware.single("file"), async (req, res, next) => {
    const logger = req.app.locals.logger as Logger | undefined;
    const requestId = createRequestId();
    const startedAt = Date.now();
    let threshold: number | null = null;
    let bufferBytes: number | null = null;
    let mimeType: string | null = null;

    try {
      if (!config.ocrEnabled) {
        throw new RequestError(503, "ocr_disabled", "OCRは無効化されています");
      }

      threshold = MIN_LIKELIHOOD;
      const payload = extractImagePayload(req);
      bufferBytes = payload.buffer.length;
      mimeType = payload.mimeType ?? null;

      logger?.info("ocr_request_start", {
        requestId,
        threshold,
        mimeType,
        bufferBytes,
        timeoutMs: config.ocrTimeoutMs,
      });

      const result = await promiseWithTimeout(
        detector.detect({ buffer: payload.buffer, mimeType: payload.mimeType }),
        config.ocrTimeoutMs
      );
      const likelihood = result.confidence;
      const rotation = likelihood >= MIN_LIKELIHOOD ? result.rotation : null;
      const durationMs = Date.now() - startedAt;

      logger?.info("ocr_request_completed", {
        requestId,
        durationMs,
        rotation,
        confidence: result.confidence,
        likelihood,
        appliedRotation: rotation,
        hasTextSample: Boolean(result.textSample),
      });

      res.json({
        success: true,
        rotation,
        confidence: result.confidence,
        likelihood,
        textSample: result.textSample,
        processingMs: durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error instanceof RequestError) {
        logger?.warn("ocr_request_failed", {
          requestId,
          durationMs,
          code: error.code,
          status: error.status,
          message: error.message,
          retryable: error.retryable,
          threshold,
          mimeType,
          bufferBytes,
        });
      } else {
        logger?.error("ocr_request_failed", {
          requestId,
          durationMs,
          threshold,
          mimeType,
          bufferBytes,
          err: error,
        });
      }
      next(error);
    }
  });

  return router;
};
