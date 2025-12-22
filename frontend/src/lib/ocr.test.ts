import { describe, expect, it, vi } from "vitest";
import { detectOrientationFromPage, renderPageToPng, requestOrientation } from "./ocr";
import type { PdfPageProxy } from "./pdf";

describe("renderPageToPng", () => {
  it("PDFページをPNGのdata URLに変換する", async () => {
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
  it("OCR APIへbase64を送り向きの推定結果を取得する", async () => {
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

  it("success=false またはHTTPエラーの場合は失敗させる", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        message: "bad",
      }),
    });

    await expect(requestOrientation("data", { fetcher })).rejects.toThrow(
      "OCRのリクエストに失敗しました: bad"
    );
  });

  it("HTTPエラーでもJSONメッセージがあればそれを表示する", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        message: "内部エラーが発生しました",
      }),
    });

    await expect(requestOrientation("data", { fetcher })).rejects.toThrow(
      "OCRのリクエストに失敗しました (HTTP 500): 内部エラーが発生しました"
    );
  });

  it("fetch自体が失敗した場合はネットワークエラー扱いにする", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("connection refused"));

    await expect(requestOrientation("data", { fetcher })).rejects.toThrow(
      "OCRのリクエストに失敗しました: ネットワークエラー"
    );
  });
});

describe("detectOrientationFromPage", () => {
  it("ページをPNG化してからOCR推定を呼び出す", async () => {
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
      render: renderMock,
      createCanvas: () => canvas,
      request: requestMock,
      scale: 1,
      rotation: 0,
    });

    expect(renderMock).toHaveBeenCalledWith(page, canvas, { scale: 1, rotation: 0 });
    expect(requestMock).toHaveBeenCalledWith({
      imageBase64: "data:image/png;base64,ABC",
      threshold: undefined,
    });
    expect(result.suggestion.rotation).toBe(0);
    expect(result.suggestion.confidence).toBeCloseTo(0.95);
    expect(result.imageBase64).toContain("ABC");
  });
});
