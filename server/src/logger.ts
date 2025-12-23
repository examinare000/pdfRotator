import fs from "node:fs";
import path from "node:path";
import { createLogger, format, transports, Logger } from "winston";

let appLogger: Logger | null = null;

const resolveLogDir = (): string => {
  const dir = process.env.LOG_DIR ?? path.resolve(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const createAppLogger = (): Logger => {
  const logDir = resolveLogDir();
  appLogger = createLogger({
    level: "info",
    format: format.combine(format.timestamp(), format.json()),
    transports: [
      new transports.File({ filename: path.join(logDir, "server.log") }),
      new transports.File({ filename: path.join(logDir, "server-error.log"), level: "error" }),
    ],
  });
  return appLogger;
};

export const getAppLogger = (): Logger | null => appLogger;
