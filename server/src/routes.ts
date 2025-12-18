import { Router } from "express";
import { AppConfig } from "./config";
import { OrientationDetector } from "./services/orientation";
import { uploadMiddleware } from "./middleware";
import { RequestError } from "./errors";
import { extractImagePayload, parseThreshold, promiseWithTimeout } from "./utils";

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
    try {
      if (!config.ocrEnabled) {
        throw new RequestError(503, "ocr_disabled", "OCRは無効化されています");
      }

      const threshold = parseThreshold(req.body?.threshold ?? req.query?.threshold);
      const { buffer, mimeType } = extractImagePayload(req);
      const startedAt = Date.now();

      const result = await promiseWithTimeout(
        detector.detect({ buffer, mimeType }),
        config.ocrTimeoutMs
      );
      const rotation = result.confidence >= threshold ? result.rotation : null;

      res.json({
        success: true,
        rotation,
        confidence: result.confidence,
        textSample: result.textSample,
        processingMs: Date.now() - startedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
