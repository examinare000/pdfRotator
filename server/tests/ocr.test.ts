import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/app";
import { createApp } from "../src/app";
import type { OrientationDetector } from "../src/services/orientation";

const samplePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WY5wAAAAASUVORK5CYII=";

const buildApp = (
  detector: OrientationDetector,
  config: Partial<AppConfig> = {}
) => {
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

describe("POST /api/ocr/orientation", () => {
  it("OCRが無効化されている場合は503を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: null,
        confidence: 0,
      }),
    };
    const app = buildApp(detector, { ocrEnabled: false });

    const res = await request(app)
      .post("/api/ocr/orientation")
      .send({ imageBase64: samplePngBase64 });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      message: "OCRは無効化されています",
    });
  });

  it("画像が提供されない場合は400を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: null,
        confidence: 0,
      }),
    };
    const app = buildApp(detector);

    const res = await request(app).post("/api/ocr/orientation").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "画像データが必要です",
    });
  });

  it("対応していないMIMEタイプは400を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: null,
        confidence: 0,
      }),
    };
    const app = buildApp(detector);

    const res = await request(app)
      .post("/api/ocr/orientation")
      .attach("file", Buffer.from("text"), {
        filename: "note.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "対応していない画像形式です",
    });
  });

  it("閾値を下回る信頼度なら rotation は null を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: 90,
        confidence: 0.5,
      }),
    };
    const app = buildApp(detector);

    const res = await request(app)
      .post("/api/ocr/orientation")
      .send({ imageBase64: samplePngBase64, threshold: 0.8 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rotation).toBeNull();
    expect(res.body.confidence).toBeCloseTo(0.5);
    expect(typeof res.body.processingMs).toBe("number");
  });

  it("正常に検出できた場合は推定結果を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: 90,
        confidence: 0.92,
        textSample: "SAMPLE",
      }),
    };
    const app = buildApp(detector);

    const res = await request(app)
      .post("/api/ocr/orientation")
      .send({ imageBase64: samplePngBase64 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      rotation: 90,
      confidence: 0.92,
      textSample: "SAMPLE",
    });
    expect(typeof res.body.processingMs).toBe("number");
  });

  it("50MBを超える画像は413とリトライ可能フラグを返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: 0,
        confidence: 1,
      }),
    };
    const app = buildApp(detector);
    const bigBuffer = Buffer.alloc(50 * 1024 * 1024 + 1);

    const res = await request(app)
      .post("/api/ocr/orientation")
      .attach("file", bigBuffer, { filename: "too-big.png", contentType: "image/png" });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      success: false,
      retryable: true,
      code: "LIMIT_FILE_SIZE",
    });
    expect(res.body.message).toContain("50MB");
  });

  it("空の画像は400とリトライ可能フラグを返す", async () => {
    const detector: OrientationDetector = {
      detect: async () => ({
        rotation: null,
        confidence: 0,
      }),
    };
    const app = buildApp(detector);

    const res = await request(app)
      .post("/api/ocr/orientation")
      .attach("file", Buffer.alloc(0), { filename: "empty.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: "empty_image",
      retryable: true,
    });
  });

  it("OCR処理がタイムアウトした場合は504を返す", async () => {
    const detector: OrientationDetector = {
      detect: async () =>
        new Promise((resolve) => setTimeout(() => resolve({
          rotation: 0,
          confidence: 0.9,
        }), 30)),
    };
    const app = buildApp(detector, { ocrTimeoutMs: 5 });

    const res = await request(app)
      .post("/api/ocr/orientation")
      .send({ imageBase64: samplePngBase64 });

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({
      success: false,
      message: "OCR処理がタイムアウトしました",
    });
  });
});
