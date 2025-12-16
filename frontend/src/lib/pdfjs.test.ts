import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => {
  const pdfDoc = { numPages: 1, getPage: vi.fn() };
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(pdfDoc) });
  const GlobalWorkerOptions: { workerSrc?: string } = {};
  return { getDocument, GlobalWorkerOptions };
});

import { createPdfJsDistLoader } from "./pdfjs";
import * as pdfjsDist from "pdfjs-dist";

describe("createPdfJsDistLoader", () => {
  it("workerSrcを設定して読み込める", async () => {
    const loader = createPdfJsDistLoader({ workerSrc: "/pdf.worker.js" });
    const buffer = new Uint8Array([1, 2]).buffer;

    const doc = await loader.loadFromArrayBuffer(buffer);

    expect(pdfjsDist.GlobalWorkerOptions.workerSrc).toBe("/pdf.worker.js");
    expect(doc.numPages).toBe(1);
  });

  it("呼び出し時のworkerSrc引数が優先される", async () => {
    const loader = createPdfJsDistLoader({ workerSrc: "/default-worker.js" });
    const buffer = new Uint8Array([3]).buffer;

    await loader.loadFromArrayBuffer(buffer, { workerSrc: "/override-worker.js" });

    expect(pdfjsDist.GlobalWorkerOptions.workerSrc).toBe("/override-worker.js");
  });
});
