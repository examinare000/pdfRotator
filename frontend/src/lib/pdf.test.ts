import { describe, expect, it, vi } from "vitest";
import { createPdfLoader, renderPageToCanvas } from "./pdf";

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

  it("viewportに合わせてキャンバスのサイズを設定する", async () => {
    const viewport = { width: 640, height: 480 };
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const page = {
      getViewport: vi.fn().mockReturnValue(viewport),
      render,
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({}),
    } as unknown as HTMLCanvasElement;

    await renderPageToCanvas(page as any, canvas, { scale: 1 });

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(render).toHaveBeenCalled();
  });
});
