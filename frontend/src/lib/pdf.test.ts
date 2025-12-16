import { describe, expect, it, vi } from "vitest";
import { createPageCache, createPdfLoader, DEFAULT_MAX_CANVAS_DIMENSION, renderPageToCanvas } from "./pdf";

const makePdfjsMock = () => {
  const pdfDoc = {
    numPages: 2,
    getPage: vi.fn(),
  };
  const getDocument = vi.fn().mockReturnValue({
    promise: Promise.resolve(pdfDoc),
  });
  const GlobalWorkerOptions: { workerSrc?: string } = {};

  return { pdfDoc, getDocument, GlobalWorkerOptions };
};

describe("createPdfLoader", () => {
  it("workerSrcが指定された場合はGlobalWorkerOptionsに設定してから読み込む", async () => {
    const pdfjs = makePdfjsMock();
    const loader = createPdfLoader(pdfjs);
    const buffer = new Uint8Array([1, 2, 3]).buffer;

    const doc = await loader.loadFromArrayBuffer(buffer, { workerSrc: "/pdf.worker.js" });

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("/pdf.worker.js");
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: buffer });
    expect(doc).toBe(pdfjs.pdfDoc);
  });

  it("workerSrcが不要な場合はそのまま読み込む", async () => {
    const pdfjs = makePdfjsMock();
    const loader = createPdfLoader(pdfjs);
    const buffer = new Uint8Array([9, 9]).buffer;

    const doc = await loader.loadFromArrayBuffer(buffer);

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBeUndefined();
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: buffer });
    expect(doc).toBe(pdfjs.pdfDoc);
  });
});

describe("renderPageToCanvas", () => {
  it("キャンバスコンテキストを取得できない場合はエラーを投げる", async () => {
    const page = {
      getViewport: vi.fn(),
      render: vi.fn(),
    };
    const canvas = { getContext: vi.fn().mockReturnValue(null) } as unknown as HTMLCanvasElement;

    await expect(renderPageToCanvas(page as any, canvas, { scale: 1 })).rejects.toThrow(
      "キャンバスのコンテキストが取得できません"
    );
  });

  it("スケールと回転を渡してレンダリングし、viewportサイズを返す", async () => {
    const viewport = { width: 800, height: 1000 };
    const renderPromise = Promise.resolve();
    const page = {
      getViewport: vi.fn().mockReturnValue(viewport),
      render: vi.fn().mockReturnValue({ promise: renderPromise }),
    };
    const ctx = {};
    const canvas = { getContext: vi.fn().mockReturnValue(ctx) } as unknown as HTMLCanvasElement;

    const result = await renderPageToCanvas(page as any, canvas, { scale: 1.5, rotation: 90 });

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 1.5, rotation: 90 });
    expect(page.render).toHaveBeenCalledWith({ canvasContext: ctx, viewport });
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(1000);
    expect(result).toEqual({ width: 800, height: 1000 });
  });

  it("回転未指定の場合は0でレンダリングする", async () => {
    const viewport = { width: 400, height: 400 };
    const page = {
      getViewport: vi.fn().mockReturnValue(viewport),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    };
    const canvas = { getContext: vi.fn().mockReturnValue({}) } as unknown as HTMLCanvasElement;

    await renderPageToCanvas(page as any, canvas, { scale: 2 });

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 2, rotation: 0 });
  });

  it("キャンバスサイズを最大幅・高さでクランプし、スケールを落として再レンダリングする", async () => {
    const firstViewport = { width: 4000, height: 2000 };
    const scaledViewport = { width: 1600, height: 800 };
    const page = {
      getViewport: vi
        .fn()
        .mockReturnValueOnce(firstViewport)
        .mockReturnValueOnce(scaledViewport),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    };
    const ctx = {};
    const canvas = { getContext: vi.fn().mockReturnValue(ctx) } as unknown as HTMLCanvasElement;

    const result = await renderPageToCanvas(page as any, canvas, { scale: 1, rotation: 0 });

    expect(page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1, rotation: 0 });
    expect(page.getViewport).toHaveBeenNthCalledWith(2, {
      scale: 1 * (DEFAULT_MAX_CANVAS_DIMENSION / firstViewport.width),
      rotation: 0,
    });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(result).toEqual({ width: 1600, height: 800 });
  });
});

describe("createPageCache", () => {
  it("最大3ページのLRUキャッシュとして動作する", () => {
    const cache = createPageCache<string>();
    cache.set(1, "one");
    cache.set(2, "two");
    cache.set(3, "three");

    expect(cache.keys()).toEqual([1, 2, 3]);

    // Access page 1 to make it most-recently-used
    expect(cache.get(1)).toBe("one");
    expect(cache.keys()).toEqual([2, 3, 1]);

    cache.set(4, "four");
    expect(cache.keys()).toEqual([3, 1, 4]);
    expect(cache.has(2)).toBe(false);
  });

  it("上限が不正な場合はエラーを投げる", () => {
    expect(() => createPageCache(0)).toThrow("キャッシュの上限は1以上の整数で指定してください");
    expect(() => createPageCache(2.5)).toThrow("キャッシュの上限は1以上の整数で指定してください");
  });
});
