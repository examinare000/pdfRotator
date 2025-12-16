import { describe, expect, it, vi } from "vitest";
import { createPdfLoader, renderPageToCanvas, resolveWorkerSrc } from "./pdf";

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

  it("workerSrcを省略した場合はbaseUrlから推定したパスを設定する", async () => {
    const pdfjs = makePdfjsMock();
    const loader = createPdfLoader(pdfjs);
    const buffer = new Uint8Array([9, 9]).buffer;

    const doc = await loader.loadFromArrayBuffer(buffer, { baseUrl: "/app/" });

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("/app/pdf.worker.js");
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: buffer });
    expect(doc).toBe(pdfjs.pdfDoc);
  });

  it("空バッファの場合はエラーを投げる", async () => {
    const pdfjs = makePdfjsMock();
    const loader = createPdfLoader(pdfjs);
    const empty = new Uint8Array().buffer;

    await expect(loader.loadFromArrayBuffer(empty)).rejects.toThrow("PDFデータが空です");
  });
});

describe("resolveWorkerSrc", () => {
  it("BASE_URLが未指定または/の場合は /pdf.worker.js を返す", () => {
    expect(resolveWorkerSrc()).toBe("/pdf.worker.js");
    expect(resolveWorkerSrc("/")).toBe("/pdf.worker.js");
  });

  it("末尾スラッシュの有無を吸収してパスを構築する", () => {
    expect(resolveWorkerSrc("/app")).toBe("/app/pdf.worker.js");
    expect(resolveWorkerSrc("/app/")).toBe("/app/pdf.worker.js");
  });

  it("空文字の場合はルートにフォールバックする", () => {
    expect(resolveWorkerSrc("")).toBe("/pdf.worker.js");
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

  it("スケールが0以下の場合はエラーを投げる", async () => {
    const page = {
      getViewport: vi.fn(),
      render: vi.fn(),
    };
    const canvas = { getContext: vi.fn().mockReturnValue({}) } as unknown as HTMLCanvasElement;

    await expect(renderPageToCanvas(page as any, canvas, { scale: 0 })).rejects.toThrow(
      "スケールは正の数で指定してください"
    );
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

  it("maxCanvasWidth/Heightに合わせてスケールをクランプし、キャンバスサイズを設定する", async () => {
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 1000 * scale,
        height: 800 * scale,
      })),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    };
    const canvas = { getContext: vi.fn().mockReturnValue({}) } as unknown as HTMLCanvasElement;

    const result = await renderPageToCanvas(page as any, canvas, {
      scale: 1.5,
      rotation: 90,
      maxCanvasWidth: 1200,
      maxCanvasHeight: 900,
    });

    expect(page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1.5, rotation: 90 });
    expect(page.getViewport).toHaveBeenLastCalledWith({ scale: 1.125, rotation: 90 });
    expect(canvas).toMatchObject({ width: 1125, height: 900 });
    expect(result).toEqual({ width: 1125, height: 900 });
  });
});
