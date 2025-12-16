import { performance } from "node:perf_hooks";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_PAGE_COUNT = 120;
const DEFAULT_MAX_CANVAS_DIMENSION = 1600;

const createSamplePdf = async (pageCount) => {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    page.drawText(`Page ${i + 1}`, {
      x: 48,
      y: height - 64,
      size: 24,
      color: undefined,
    });
    page.drawText("Rendering benchmark sample", {
      x: 48,
      y: height - 96,
      size: 12,
    });
  }
  return pdfDoc.save();
};

const clampViewportDimension = (width, height, maxSize) => {
  const widthScale = width > maxSize ? maxSize / width : 1;
  const heightScale = height > maxSize ? maxSize / height : 1;
  const scale = Math.min(widthScale, heightScale);
  return {
    scale,
    width: width * scale,
    height: height * scale,
  };
};

const renderFirstPage = async (pdf) => {
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const clamped = clampViewportDimension(
    baseViewport.width,
    baseViewport.height,
    DEFAULT_MAX_CANVAS_DIMENSION
  );
  const viewport =
    clamped.scale < 1 ? page.getViewport({ scale: clamped.scale }) : baseViewport;

  try {
    const { createCanvas } = await import("canvas");
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    const startedAt = performance.now();
    await page.render({ canvasContext: context, viewport }).promise;
    const renderMs = performance.now() - startedAt;
    return { renderMs, viewport };
  } catch (error) {
    console.warn(
      "canvas パッケージが見つからないためレンダリング計測をスキップします",
      error.message ?? error
    );
    return { renderMs: null, viewport };
  }
};

const measure = async () => {
  const pageCount = Number(process.env.PAGE_COUNT ?? DEFAULT_PAGE_COUNT);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new Error("PAGE_COUNT は1以上の数値で指定してください");
  }

  console.log(`Generating sample PDF with ${pageCount} pages...`);
  const createStart = performance.now();
  const pdfBytes = await createSamplePdf(pageCount);
  const createMs = performance.now() - createStart;

  console.log(`Loading PDF (${pdfBytes.byteLength} bytes)...`);
  const loadStart = performance.now();
  const task = getDocument({
    data: pdfBytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const loadMs = performance.now() - loadStart;

  const { renderMs, viewport } = await renderFirstPage(pdf);

  console.log("---- Measurement Result ----");
  console.log(
    JSON.stringify(
      {
        pages: pdf.numPages,
        createMs: Number(createMs.toFixed(1)),
        loadMs: Number(loadMs.toFixed(1)),
        renderMs: renderMs !== null ? Number(renderMs.toFixed(1)) : null,
        viewport: {
          width: Number(viewport.width.toFixed(1)),
          height: Number(viewport.height.toFixed(1)),
        },
      },
      null,
      2
    )
  );
};

measure().catch((error) => {
  console.error(error);
  process.exit(1);
});
