import type { RequestHandler } from "express";
import type { Logger } from "winston";
import { RequestError } from "../errors";
import type { AppConfig } from "../config";
import type { OrientationDetector } from "../services/orientation";
import { extractImagePayload, promiseWithTimeout } from "../utils";
import { createRequestId } from "../utils/request-id";

const MIN_LIKELIHOOD = 0.6;

type OcrLogContext = {
  requestId: string;
  threshold: number;
  startedAt: number;
  bufferBytes: number | null;
  mimeType: string | null;
};

const createOcrLogContext = (): OcrLogContext => {
  return {
    requestId: createRequestId(),
    threshold: MIN_LIKELIHOOD,
    startedAt: Date.now(),
    bufferBytes: null,
    mimeType: null,
  };
};

const logRequestStart = (logger: Logger | undefined, context: OcrLogContext, timeoutMs: number) => {
  logger?.info("ocr_request_start", {
    requestId: context.requestId,
    threshold: context.threshold,
    mimeType: context.mimeType,
    bufferBytes: context.bufferBytes,
    timeoutMs,
  });
};

const logRequestCompleted = (
  logger: Logger | undefined,
  context: OcrLogContext,
  result: { rotation: number | null; confidence: number; likelihood: number; hasTextSample: boolean },
  durationMs: number
) => {
  logger?.info("ocr_request_completed", {
    requestId: context.requestId,
    durationMs,
    rotation: result.rotation,
    confidence: result.confidence,
    likelihood: result.likelihood,
    appliedRotation: result.rotation,
    hasTextSample: result.hasTextSample,
  });
};

const logRequestFailed = (
  logger: Logger | undefined,
  context: OcrLogContext,
  error: unknown,
  durationMs: number
) => {
  if (error instanceof RequestError) {
    logger?.warn("ocr_request_failed", {
      requestId: context.requestId,
      durationMs,
      code: error.code,
      status: error.status,
      message: error.message,
      retryable: error.retryable,
      threshold: context.threshold,
      mimeType: context.mimeType,
      bufferBytes: context.bufferBytes,
    });
    return;
  }

  logger?.error("ocr_request_failed", {
    requestId: context.requestId,
    durationMs,
    threshold: context.threshold,
    mimeType: context.mimeType,
    bufferBytes: context.bufferBytes,
    err: error,
  });
};

export const createOcrHandler = (
  config: AppConfig,
  detector: OrientationDetector
): RequestHandler => {
  return async (req, res, next) => {
    const logger = req.app.locals.logger as Logger | undefined;
    const context = createOcrLogContext();

    try {
      if (!config.ocrEnabled) {
        throw new RequestError(503, "ocr_disabled", "OCRは無効化されています");
      }

      const payload = extractImagePayload(req);
      context.bufferBytes = payload.buffer.length;
      context.mimeType = payload.mimeType ?? null;

      logRequestStart(logger, context, config.ocrTimeoutMs);

      const result = await promiseWithTimeout(
        detector.detect({ buffer: payload.buffer, mimeType: payload.mimeType }),
        config.ocrTimeoutMs
      );
      const likelihood = result.confidence;
      const rotation = likelihood >= MIN_LIKELIHOOD ? result.rotation : null;
      const durationMs = Date.now() - context.startedAt;

      logRequestCompleted(
        logger,
        context,
        {
          rotation,
          confidence: result.confidence,
          likelihood,
          hasTextSample: Boolean(result.textSample),
        },
        durationMs
      );

      res.json({
        success: true,
        rotation,
        confidence: result.confidence,
        likelihood,
        textSample: result.textSample,
        processingMs: durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - context.startedAt;
      logRequestFailed(logger, context, error, durationMs);
      next(error);
    }
  };
};
