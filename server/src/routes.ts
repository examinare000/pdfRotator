import { Router } from "express";
import { AppConfig } from "./config";
import { createHealthHandler } from "./handlers/health";
import { createLogsHandler } from "./handlers/logs";
import { createOcrHandler } from "./handlers/ocr";
import { uploadMiddleware } from "./middleware";
import { OrientationDetector } from "./services/orientation";

export const createApiRouter = (config: AppConfig, detector: OrientationDetector): Router => {
  const router = Router();

  router.get("/health", createHealthHandler(config));
  router.post("/ocr/orientation", uploadMiddleware.single("file"), createOcrHandler(config, detector));
  router.post("/logs", createLogsHandler());

  return router;
};
