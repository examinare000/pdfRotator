import { describe, expect, it, vi } from "vitest";
import { createTesseractDetector } from "../src/services/orientation";

const baseBuffer = Buffer.from("image");

describe("createTesseractDetector", () => {
  it("外周のページ番号が最も多い回転を返し、信頼度を比率で計算する", async () => {
    const rotate = vi.fn(async (_buffer: Buffer, degrees: number) => Buffer.from(`rot-${degrees}`));
    const recognize = vi.fn(async (buffer: Buffer) => {
      const asString = buffer.toString();
      if (asString.includes("rot-0")) {
        return {
          data: {
            imageSize: { width: 1000, height: 1000 },
            words: [
              { text: "HEADER", confidence: 95, bbox: { x0: 200, y0: 200, x1: 300, y1: 230 } },
              { text: "1", confidence: 95, bbox: { x0: 450, y0: 970, x1: 470, y1: 990 } },
            ],
          },
        };
      }
      if (asString.includes("rot-90")) {
        return {
          data: {
            imageSize: { width: 1000, height: 1000 },
            words: [{ text: "12", confidence: 92, bbox: { x0: 5, y0: 500, x1: 25, y1: 520 } }],
          },
        };
      }
      if (asString.includes("rot-180")) {
        return {
          data: {
            imageSize: { width: 1000, height: 1000 },
            words: [{ text: "999", confidence: 95, bbox: { x0: 300, y0: 300, x1: 350, y1: 320 } }],
          },
        };
      }
      return {
        data: {
          imageSize: { width: 1000, height: 1000 },
          words: [{ text: "3", confidence: 40, bbox: { x0: 5, y0: 5, x1: 25, y1: 25 } }],
        },
      };
    });

    const detector = createTesseractDetector({ rotate, recognize });
    const result = await detector.detect({ buffer: baseBuffer });

    expect(result.rotation).toBe(90);
    expect(result.confidence).toBeCloseTo(2 / 3);
    expect(rotate).toHaveBeenCalledTimes(4);
    expect(recognize).toHaveBeenCalledTimes(4);
  });

  it("外周にページ番号が無い場合は rotation=null を返す", async () => {
    const rotate = vi.fn(async (_buffer: Buffer, degrees: number) => Buffer.from(`rot-${degrees}`));
    const recognize = vi.fn(async () => ({
      data: {
        imageSize: { width: 1000, height: 1000 },
        words: [
          { text: "HEADER", confidence: 95, bbox: { x0: 200, y0: 200, x1: 300, y1: 230 } },
          { text: "12", confidence: 95, bbox: { x0: 400, y0: 400, x1: 420, y1: 420 } },
        ],
      },
    }));

    const detector = createTesseractDetector({ rotate, recognize });
    const result = await detector.detect({ buffer: baseBuffer });

    expect(result.rotation).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
