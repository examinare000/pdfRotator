import { describe, expect, it, vi } from "vitest";
import { createTesseractDetector } from "../src/services/orientation";

const baseBuffer = Buffer.from("image");

describe("createTesseractDetector", () => {
  it("文字数が最も多い回転を返し、信頼度を比率で計算する", async () => {
    const rotate = vi.fn(async (_buffer: Buffer, degrees: number) => Buffer.from(`rot-${degrees}`));
    const recognize = vi.fn(async (buffer: Buffer) => {
      const text = buffer.toString().includes("90")
        ? "ABCDE"
        : buffer.toString().includes("180")
          ? "AB"
          : "";
      return { data: { text } };
    });

    const detector = createTesseractDetector({ rotate, recognize });
    const result = await detector.detect({ buffer: baseBuffer });

    expect(result.rotation).toBe(90);
    expect(result.confidence).toBeCloseTo(5 / 7);
    expect(rotate).toHaveBeenCalledTimes(4);
    expect(recognize).toHaveBeenCalledTimes(4);
  });

  it("斜め文字の多い行は無視して向きを選ぶ", async () => {
    const rotate = vi.fn(async (_buffer: Buffer, degrees: number) => Buffer.from(`rot-${degrees}`));
    const recognize = vi.fn(async (buffer: Buffer) => {
      const asString = buffer.toString();
      if (asString.includes("rot-0")) {
        return {
          data: {
            text: "DIAGONALDIAGONAL A",
            lines: [
              {
                text: "DIAGONALDIAGONAL",
                baseline: { x0: 0, y0: 0, x1: 10, y1: 10 }, // 約45°
              },
              {
                text: "A",
                baseline: { x0: 0, y0: 0, x1: 10, y1: 0 }, // 0°
              },
            ],
          },
        };
      }
      if (asString.includes("rot-90")) {
        return {
          data: {
            text: "ABCDE",
            lines: [{ text: "ABCDE", baseline: { x0: 0, y0: 0, x1: 10, y1: 0 } }],
          },
        };
      }

      return { data: { text: "" } };
    });

    const detector = createTesseractDetector({ rotate, recognize });
    const result = await detector.detect({ buffer: baseBuffer });

    expect(result.rotation).toBe(90);
  });

  it("すべての回転で文字が認識できない場合は rotation=null を返す", async () => {
    const rotate = vi.fn(async (_buffer: Buffer, degrees: number) => Buffer.from(`rot-${degrees}`));
    const recognize = vi.fn(async () => ({ data: { text: "   " } }));

    const detector = createTesseractDetector({ rotate, recognize });
    const result = await detector.detect({ buffer: baseBuffer });

    expect(result.rotation).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
