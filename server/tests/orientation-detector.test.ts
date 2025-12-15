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
    const normalizedText = (result.textSample ?? "").replace(/\s+/g, "").toUpperCase();
    expect(normalizedText).toContain("UP");
  });
});
