import { describe, expect, it, vi } from "vitest";
import { createPdfLoader, type PdfDocumentProxy, type PdfJsLike } from "./pdf";

const makeDoc = (): PdfDocumentProxy => ({
  numPages: 1,
  getPage: vi.fn(),
});

describe("createPdfLoader", () => {
  it("PDF.js に渡しても呼び出し元の ArrayBuffer が detached にならない", async () => {
    const doc = makeDoc();
    const pdfjs: PdfJsLike = {
      getDocument: ({ data }) => {
        structuredClone(data, { transfer: [data] });
        return { promise: Promise.resolve(doc) };
      },
      GlobalWorkerOptions: {},
    };

    const loader = createPdfLoader(pdfjs);
    const buffer = new Uint8Array([1, 2, 3]).buffer;

    await loader.loadFromArrayBuffer(buffer, { workerSrc: "/dummy-worker.js" });

    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

