import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const makeStaticDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfrotator-static-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>Hello Static</body></html>");
  return dir;
};

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("静的ファイル配信とSPAフォールバック", () => {
  it("ルートパスでindex.htmlを返す", async () => {
    tempDir = makeStaticDir();
    const app = createApp({ config: { staticDir: tempDir } });

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Hello Static");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("/unknown でもSPAフォールバックとしてindex.htmlを返す", async () => {
    tempDir = makeStaticDir();
    const app = createApp({ config: { staticDir: tempDir } });

    const res = await request(app).get("/any/path");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Hello Static");
  });
});
