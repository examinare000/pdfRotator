import { describe, expect, it, vi } from "vitest";

const pdfjsMocks = vi.hoisted(() => {
  const pdfDoc = { numPages: 1, getPage: vi.fn() };
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(pdfDoc) });
  const GlobalWorkerOptions: { workerSrc?: string } = {};
  const pdfjsMockFactory = vi.fn(() => ({ getDocument, GlobalWorkerOptions }));
  return {
    pdfDoc,
    getDocument,
    GlobalWorkerOptions,
    pdfjsMockFactory,
  };
});

vi.mock("pdfjs-dist", pdfjsMocks.pdfjsMockFactory);

const loadPdfJsDistLoader = async () => (await import("./pdfjs")).createPdfJsDistLoader;
const importPdfjsDist = async () => await import("pdfjs-dist");

describe("createPdfJsDistLoader", () => {
  it("pdfjs-distを遅延ロードする", async () => {
    await vi.resetModules();
    pdfjsMocks.pdfjsMockFactory.mockClear();
    const createPdfJsDistLoader = await loadPdfJsDistLoader();
    const loader = createPdfJsDistLoader({ workerSrc: "/pdf.worker.js" });
    const buffer = new Uint8Array([1]).buffer;

    expect(pdfjsMocks.pdfjsMockFactory).not.toHaveBeenCalled();

    await loader.loadFromArrayBuffer(buffer);

    expect(pdfjsMocks.pdfjsMockFactory).toHaveBeenCalledTimes(1);
  });

  it("workerSrcを設定して読み込める", async () => {
    const createPdfJsDistLoader = await loadPdfJsDistLoader();
    const loader = createPdfJsDistLoader({ workerSrc: "/pdf.worker.js" });
    const buffer = new Uint8Array([1, 2]).buffer;

    const doc = await loader.loadFromArrayBuffer(buffer);
    const pdfjsDist = await importPdfjsDist();

    expect(pdfjsDist.GlobalWorkerOptions.workerSrc).toBe("/pdf.worker.js");
    expect(doc.numPages).toBe(1);
  });

  it("呼び出し時のworkerSrc引数が優先される", async () => {
    const createPdfJsDistLoader = await loadPdfJsDistLoader();
    const loader = createPdfJsDistLoader({ workerSrc: "/default-worker.js" });
    const buffer = new Uint8Array([3]).buffer;

    await loader.loadFromArrayBuffer(buffer, { workerSrc: "/override-worker.js" });
    const pdfjsDist = await importPdfjsDist();

    expect(pdfjsDist.GlobalWorkerOptions.workerSrc).toBe("/override-worker.js");
  });
});
