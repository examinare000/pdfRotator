import type { RequestHandler } from "express";
import type { Logger } from "winston";
import { normalizeLogLevel, parseClientLogPayload } from "../utils/logs";

export const createLogsHandler = (): RequestHandler => {
  return (req, res) => {
    const logger = req.app.locals.logger as Logger | undefined;
    const payload = parseClientLogPayload(req.body);

    if (!payload) {
      res.status(400).json({ success: false, message: "invalid log payload" });
      return;
    }

    const safeLevel = normalizeLogLevel(payload.level);
    logger?.log(safeLevel, "client_log", {
      message: payload.message,
      context: payload.context,
      timestamp: payload.timestamp,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    res.json({ success: true });
  };
};
