import { saveAs } from "file-saver";
import { PDFDocument, degrees } from "pdf-lib";
import type { PageRotationMap } from "./rotation";

export type SaveOptions = {
  fileName?: string;
  /**
   * 保存ダイアログがブロックされた場合に新規タブで開くフォールバックを有効化する
   * Safari/一部の環境では有効になる
   */
  enableFallbackOpen?: boolean;
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

  try {
    saveAs(blob, fileName);
  } catch (error) {
    if (options.enableFallbackOpen) {
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank");
      if (!opened) {
        throw error;
      }
      return;
    }
    throw error;
  }
};
