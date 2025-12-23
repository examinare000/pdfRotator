import { createPdfLoader, type PdfDocumentProxy, type PdfJsLike, type PdfLoader } from "./pdf";

export type PdfJsDistOptions = {
  workerSrc?: string;
};

type PdfJsDistModule = typeof import("pdfjs-dist");

let pdfjsModulePromise: Promise<PdfJsDistModule> | null = null;

const loadPdfJsDist = async (): Promise<PdfJsDistModule> => {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist");
  }
  return pdfjsModulePromise;
};

export const createPdfJsDistLoader = (options: PdfJsDistOptions = {}): PdfLoader => {
  let loaderPromise: Promise<PdfLoader> | null = null;

  const getLoader = async () => {
    if (!loaderPromise) {
      loaderPromise = loadPdfJsDist().then((pdfjsDist) => {
        const pdfjsLike: PdfJsLike = {
          getDocument: ({ data }) =>
            pdfjsDist.getDocument({ data }) as unknown as { promise: Promise<PdfDocumentProxy> },
          GlobalWorkerOptions: pdfjsDist.GlobalWorkerOptions as unknown as { workerSrc?: string },
        };
        return createPdfLoader(pdfjsLike);
      });
    }
    return loaderPromise;
  };

  return {
    loadFromArrayBuffer: async (buffer, extraOptions) => {
      const workerSrc = extraOptions?.workerSrc ?? options.workerSrc;
      const loader = await getLoader();
      return loader.loadFromArrayBuffer(buffer, { workerSrc });
    },
  };
};
