import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { createPdfLoader, type PdfJsLike, type PdfLoader } from "./pdf";

export type PdfJsDistOptions = {
  workerSrc?: string;
};

export const createPdfJsDistLoader = (options: PdfJsDistOptions = {}): PdfLoader => {
  const pdfjsLike: PdfJsLike = {
    getDocument: ({ data }) => getDocument({ data }) as unknown as { promise: Promise<any> },
    GlobalWorkerOptions: GlobalWorkerOptions as unknown as { workerSrc?: string },
  };
  const loader = createPdfLoader(pdfjsLike);
  return {
    loadFromArrayBuffer: async (buffer, extraOptions) => {
      const workerSrc = extraOptions?.workerSrc ?? options.workerSrc;
      return loader.loadFromArrayBuffer(buffer, { workerSrc });
    },
  };
};
