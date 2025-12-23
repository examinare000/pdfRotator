import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/app";
import { createApp } from "../src/app";
import type { OrientationDetector } from "../src/services/orientation";
import type { Logger } from "winston";

const buildApp = (config: Partial<AppConfig> = {}) => {
  const detector: OrientationDetector = {
    detect: async () => ({
      rotation: null,
      confidence: 0,
    }),
  };
  return createApp({
    detector,
    config: {
      corsOrigin: "http://localhost:5173",
      ocrEnabled: true,
      ocrTimeoutMs: 1500,
      ...config,
    },
  });
};

const createMockLogger = (): Logger =>
  ({
    log: () => undefined,
  } as Logger);

describe("POST /api/logs", () => {
  it("ログを受け取ってロガーに渡す", async () => {
    const app = buildApp();
    const logger = createMockLogger();
    logger.log = vi.fn();
    app.locals.logger = logger;

    const res = await request(app).post("/api/logs").send({
      level: "warn",
      message: "client message",
      context: { source: "ui" },
      timestamp: "2025-12-23T10:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(logger.log).toHaveBeenCalledWith(
      "warn",
      "client_log",
      expect.objectContaining({
        message: "client message",
        context: { source: "ui" },
        timestamp: "2025-12-23T10:00:00.000Z",
      })
    );
  });

  it("不正なペイロードは400を返す", async () => {
    const app = buildApp();
    const logger = createMockLogger();
    logger.log = vi.fn();
    app.locals.logger = logger;

    const res = await request(app).post("/api/logs").send({ level: 12 });

    expect(res.status).toBe(400);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("未知のレベルはinfoとして扱う", async () => {
    const app = buildApp();
    const logger = createMockLogger();
    logger.log = vi.fn();
    app.locals.logger = logger;

    const res = await request(app).post("/api/logs").send({
      level: "trace",
      message: "client message",
    });

    expect(res.status).toBe(200);
    expect(logger.log).toHaveBeenCalledWith(
      "info",
      "client_log",
      expect.objectContaining({ message: "client message" })
    );
  });
});
