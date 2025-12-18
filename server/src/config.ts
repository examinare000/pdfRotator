import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"];
export const MAX_UPLOAD_MB = 50;
export const MAX_FILE_SIZE = MAX_UPLOAD_MB * 1024 * 1024;
export const BODY_LIMIT = "70mb";

export type AppConfig = {
  corsOrigin: string;
  ocrEnabled: boolean;
  ocrTimeoutMs: number;
  staticDir: string;
};

export const buildConfig = (override?: Partial<AppConfig>): AppConfig => {
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
