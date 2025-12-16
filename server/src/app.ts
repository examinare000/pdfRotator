import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import express, { type Application } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import { createLogger, format, transports } from "winston";
import { createTesseractDetector, type OrientationDetector } from "./services/orientation";

dotenv.config();

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"];
const MAX_UPLOAD_MB = 50;
const MAX_FILE_SIZE = MAX_UPLOAD_MB * 1024 * 1024;
const BODY_LIMIT = "70mb";

export type AppConfig = {
  corsOrigin: string;
  ocrEnabled: boolean;
  ocrTimeoutMs: number;
  staticDir: string;
};

type CreateAppOptions = {
  detector?: OrientationDetector;
  config?: Partial<AppConfig>;
};

class RequestError extends Error {
  status: number;

  code: string;

  retryable: boolean;

  constructor(status: number, code: string, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

const buildConfig = (override?: Partial<AppConfig>): AppConfig => {
  const ocrEnabledEnv = process.env.OCR_ENABLED ?? "true";
  const fallbackStaticDir = path.resolve(__dirname, "../public");
  return {
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    ocrEnabled: ocrEnabledEnv.toLowerCase() !== "false",
    ocrTimeoutMs: Number(process.env.OCR_TIMEOUT_MS ?? 1500),
    staticDir: override?.staticDir
      ?? process.env.STATIC_DIR
      ?? fallbackStaticDir,
    ...override,
  };
};

const isBase64 = (value: string): boolean => {
  const trimmed = value.trim();
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
};

const parseThreshold = (raw: unknown): number => {
  if (raw === undefined || raw === null || raw === "") {
    return 0.6;
  }
  const threshold = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new RequestError(400, "invalid_threshold", "threshold は 0 以上 1 以下の数値で指定してください");
  }
  return threshold;
};

const promiseWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
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

const ensureUsableBuffer = (buffer: Buffer | undefined): Buffer => {
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

const extractBase64 = (raw: string): Buffer => {
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

const extractImagePayload = (req: express.Request) => {
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

export const createApp = ({ detector, config }: CreateAppOptions = {}): Application => {
  const resolvedConfig = buildConfig(config);
  const logger = createLogger({
    level: "info",
    format: format.combine(format.timestamp(), format.json()),
    transports: [new transports.Console()],
  });
  const ocrDetector = detector ?? createTesseractDetector();
  const staticDir = resolvedConfig.staticDir;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(new RequestError(400, "unsupported_mime", "対応していない画像形式です"));
        return;
      }
      cb(null, true);
    },
  });

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
  app.use(morgan("combined"));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: process.env.npm_package_version ?? "dev" });
  });

  app.post("/api/ocr/orientation", upload.single("file"), async (req, res, next) => {
    try {
      if (!resolvedConfig.ocrEnabled) {
        throw new RequestError(503, "ocr_disabled", "OCRは無効化されています");
      }

      const threshold = parseThreshold(req.body?.threshold ?? req.query?.threshold);
      const { buffer, mimeType } = extractImagePayload(req);
      const startedAt = Date.now();

      const result = await promiseWithTimeout(
        ocrDetector.detect({ buffer, mimeType }),
        resolvedConfig.ocrTimeoutMs
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

  const staticIndexPath = staticDir ? path.join(staticDir, "index.html") : null;
  const hasStatic = staticIndexPath ? fs.existsSync(staticIndexPath) : false;
  if (hasStatic && staticDir && staticIndexPath) {
    const indexPath = staticIndexPath;
    app.use(express.static(staticDir));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(indexPath);
    });
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof RequestError) {
        logger.warn("handled_request_error", { code: err.code, message: err.message, retryable: err.retryable });
        res
          .status(err.status)
          .json({ success: false, message: err.message, code: err.code, retryable: err.retryable });
        return;
      }

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res
            .status(413)
            .json({
              success: false,
              message: `ファイルサイズが上限を超えています（${MAX_UPLOAD_MB}MB 以内）。画像を小さくして再度お試しください。`,
              code: err.code,
              retryable: true,
            });
          return;
        }
        res.status(400).json({
          success: false,
          message: "ファイルのアップロードに失敗しました。別の画像で再度お試しください。",
          code: err.code,
          retryable: true,
        });
        return;
      }

      logger.error("unhandled_error", { err });
      res.status(500).json({ success: false, message: "内部エラーが発生しました", retryable: false });
    }
  );

  return app;
};
