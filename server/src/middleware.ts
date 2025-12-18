import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { RequestError } from "./errors";
import { MAX_FILE_SIZE, MAX_UPLOAD_MB, ALLOWED_MIME_TYPES } from "./config";
import { Logger } from "winston";

export const uploadMiddleware = multer({
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

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const logger = req.app.locals.logger as Logger;

  if (err instanceof RequestError) {
    logger?.warn("handled_request_error", { code: err.code, message: err.message, retryable: err.retryable });
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

  logger?.error("unhandled_error", { err });
  res.status(500).json({ success: false, message: "内部エラーが発生しました", retryable: false });
};
