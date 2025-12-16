import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { createPdfLoader, type PdfLoader } from "./pdf";

export type PdfJsDistOptions = {
  workerSrc?: string;
};

export const createPdfJsDistLoader = (options: PdfJsDistOptions = {}): PdfLoader => {
  const loader = createPdfLoader({ getDocument, GlobalWorkerOptions });
  return {
    loadFromArrayBuffer: async (buffer, extraOptions) => {
      const workerSrc = extraOptions?.workerSrc ?? options.workerSrc;
      return loader.loadFromArrayBuffer(buffer, { workerSrc });
    },
  };
};
