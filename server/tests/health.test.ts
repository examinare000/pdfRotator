import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("バージョンとOCR有効/無効を返す", async () => {
    const app = createApp({ config: { ocrEnabled: false } });

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      ocrEnabled: false,
    });
    expect(typeof res.body.version).toBe("string");
  });
});

