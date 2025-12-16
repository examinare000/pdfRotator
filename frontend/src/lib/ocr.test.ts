import { describe, expect, it, vi } from "vitest";
import { detectOrientationFromPage, renderPageToPng, requestOrientation } from "./ocr";
import type { PdfPageProxy } from "./pdf";

describe("renderPageToPng", () => {
  it("PDFページをPNGのdata URLとして返す", async () => {
    const renderMock = vi.fn().mockResolvedValue({ width: 320, height: 480 });
    const canvas = {
      getContext: vi.fn().mockReturnValue({}),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,AAA"),
    } as unknown as HTMLCanvasElement;
    const page = {} as PdfPageProxy;

    const result = await renderPageToPng(page, {
      render: renderMock,
      createCanvas: () => canvas,
      scale: 1.25,
      rotation: 90,
    });

    expect(renderMock).toHaveBeenCalledWith(page, canvas, { scale: 1.25, rotation: 90 });
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(result).toEqual({
      dataUrl: "data:image/png;base64,AAA",
      viewport: { width: 320, height: 480 },
    });
  });
});

describe("requestOrientation", () => {
  it("OCR APIにbase64画像としきい値を送信する", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        rotation: 90,
        confidence: 0.81,
        processingMs: 120,
      }),
    });

    const result = await requestOrientation("base64-image", { threshold: 0.7, fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/ocr/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "base64-image", threshold: 0.7 }),
    });
    expect(result.rotation).toBe(90);
    expect(result.confidence).toBeCloseTo(0.81);
    expect(result.processingMs).toBe(120);
  });

  it("success=false や HTTP エラーの場合は例外を投げる", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        message: "bad",
      }),
    });

    await expect(requestOrientation("data", { fetcher })).rejects.toThrow("OCRの呼び出しに失敗しました");
  });
});

describe("detectOrientationFromPage", () => {
  it("ページをPNG化してからOCR推定を行う", async () => {
    const renderMock = vi.fn().mockResolvedValue({ width: 100, height: 200 });
    const canvas = {
      getContext: vi.fn().mockReturnValue({}),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,ABC"),
    } as unknown as HTMLCanvasElement;
    const requestMock = vi.fn().mockResolvedValue({
      success: true,
      rotation: 0,
      confidence: 0.95,
      processingMs: 10,
    });
    const page = {} as PdfPageProxy;

    const result = await detectOrientationFromPage({
      page,
      threshold: 0.9,
      render: renderMock,
      createCanvas: () => canvas,
      request: requestMock,
      scale: 1,
      rotation: 0,
    });

    expect(renderMock).toHaveBeenCalledWith(page, canvas, { scale: 1, rotation: 0 });
    expect(requestMock).toHaveBeenCalledWith({
      imageBase64: "data:image/png;base64,ABC",
      threshold: 0.9,
    });
    expect(result.suggestion.rotation).toBe(0);
    expect(result.suggestion.confidence).toBeCloseTo(0.95);
    expect(result.imageBase64).toContain("ABC");
  });
});
