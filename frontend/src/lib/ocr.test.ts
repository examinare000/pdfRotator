import { describe, expect, it, vi } from "vitest";
import type { PdfDocumentProxy } from "./pdf";
import { detectOrientationForPage, requestOrientationDetection } from "./ocr";

describe("requestOrientationDetection", () => {
  it("Base64画像をAPIに送り推定結果を返す", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        rotation: 90,
        confidence: 0.82,
        processingMs: 120,
      }),
    });

    const result = await requestOrientationDetection("AAA", { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/ocr/orientation",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: "AAA" }),
      })
    );
    expect(result).toMatchObject({ rotation: 90, confidence: 0.82, processingMs: 120 });
  });

  it("APIが失敗を返した場合はエラーにする", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "画像が必要です" }),
    });

    await expect(requestOrientationDetection("AAA", { fetcher })).rejects.toThrow(
      "OCRの推定に失敗しました: 画像が必要です"
    );
  });
});

describe("detectOrientationForPage", () => {
  const makePage = () => {
    const viewport = { width: 320, height: 240 };
    return {
      viewport,
      page: {
        getViewport: vi.fn().mockReturnValue(viewport),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      },
    };
  };

  const makeDoc = (page: any): PdfDocumentProxy => ({
    numPages: 3,
    getPage: vi.fn().mockResolvedValue(page),
  });

  it("指定ページを画像化して推定する", async () => {
    const { page, viewport } = makePage();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({}),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,AAA"),
    } as unknown as HTMLCanvasElement;
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, rotation: 270, confidence: 0.9 }),
    });
    const doc = makeDoc(page);

    const result = await detectOrientationForPage(doc, 2, { fetcher, createCanvas: () => canvas });

    expect(doc.getPage).toHaveBeenCalledWith(2);
    expect(canvas.width).toBe(viewport.width);
    expect(canvas.height).toBe(viewport.height);
    expect(fetcher).toHaveBeenCalled();
    expect(result).toMatchObject({ page: 2, rotation: 270, confidence: 0.9 });
  });

  it("画像生成に失敗した場合はエラーにする", async () => {
    const { page } = makePage();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({}),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,"),
    } as unknown as HTMLCanvasElement;
    const fetcher = vi.fn();
    const doc = makeDoc(page);

    await expect(
      detectOrientationForPage(doc, 1, { fetcher, createCanvas: () => canvas })
    ).rejects.toThrow("ページ画像の取得に失敗しました");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
