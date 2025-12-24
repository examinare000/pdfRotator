import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTesseractDetector } from "../src/services/orientation";

describe("createTesseractDetector", () => {
  it("Tesseractで向きとテキストサンプルを取得できる", async () => {
    const detector = createTesseractDetector();
    const fixturePath = path.join(__dirname, "fixtures", "orientation-up.png");
    const buffer = fs.readFileSync(fixturePath);

    const result = await detector.detect({ buffer, mimeType: "image/png" });

    expect(result.rotation).toBe(0);
    expect(result.confidence).toBeGreaterThan(0);
    // detectWithPageNumberSweepはページ番号（数字）をtextSampleとして返す
    // テスト画像の下部にある「1」が検出される
    expect(result.textSample).toBeDefined();
    expect(result.textSample).toContain("1");
  }, 20000);
});
