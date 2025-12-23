import fs from "node:fs";
import path from "node:path";
import express, { type Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { createTesseractDetector, type OrientationDetector } from "./services/orientation";
import { AppConfig, buildConfig, BODY_LIMIT } from "./config";
import { createAppLogger } from "./logger";
import { errorHandler } from "./middleware";
import { createApiRouter } from "./routes";

type CreateAppOptions = {
  detector?: OrientationDetector;
  config?: Partial<AppConfig>;
};

export type { AppConfig };

export const createApp = ({ detector, config }: CreateAppOptions = {}): Application => {
  const resolvedConfig = buildConfig(config);
  const logger = createAppLogger();
  const ocrDetector = detector ?? createTesseractDetector();
  const staticDir = resolvedConfig.staticDir;

  const app = express();
  app.locals.logger = logger;

  app.use(helmet());
  app.use(
    cors({
      origin: resolvedConfig.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(
    morgan("combined", {
      stream: {
        write: (message) => {
          logger.info("http_request", { message: message.trim() });
        },
      },
    })
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // APIルート
  app.use("/api", createApiRouter(resolvedConfig, ocrDetector));

  // 静的ファイル配信
  const staticIndexPath = staticDir ? path.join(staticDir, "index.html") : null;
  const hasStatic = staticIndexPath ? fs.existsSync(staticIndexPath) : false;

  if (hasStatic && staticDir && staticIndexPath) {
    app.use(express.static(staticDir));
    // SPAフォールバック（非APIルート）
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(staticIndexPath);
    });
  }

  // グローバルエラーハンドラ
  app.use(errorHandler);

  return app;
};
