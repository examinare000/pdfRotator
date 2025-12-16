import { saveAs } from "file-saver";
import { PDFDocument, degrees } from "pdf-lib";
import type { PageRotationMap } from "./rotation";

export type SaveOptions = {
  fileName?: string;
};

export const savePdfWithRotation = async (
  originalBuffer: ArrayBuffer,
  rotationMap: PageRotationMap,
  options: SaveOptions = {}
): Promise<void> => {
  if (!originalBuffer || originalBuffer.byteLength === 0) {
    throw new Error("保存するPDFデータが空です");
  }

  const pdfDoc = await PDFDocument.load(originalBuffer);
  const pages = pdfDoc.getPages();

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const rotation = rotationMap[pageNumber] ?? 0;
    page.setRotation(degrees(rotation));
  });

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const fileName = options.fileName ?? "rotated.pdf";
  saveAs(blob, fileName);
};
