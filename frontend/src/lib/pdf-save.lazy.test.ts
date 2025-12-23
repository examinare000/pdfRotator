import { describe, expect, it, vi } from "vitest";

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}));

const pdfLibMocks = vi.hoisted(() => {
  const mocks = {
    PDFDocument: {
      load: vi.fn(),
    },
    degrees: vi.fn((value: number) => value),
    page: {
      setRotation: vi.fn(),
    },
  };
  const pdfLibMockFactory = vi.fn(() => ({
    PDFDocument: {
      load: mocks.PDFDocument.load,
    },
    degrees: mocks.degrees,
  }));
  return { mocks, pdfLibMockFactory };
});

vi.mock("pdf-lib", pdfLibMocks.pdfLibMockFactory);

describe("savePdfWithRotation (lazy import)", () => {
  it("pdf-libを遅延ロードして保存処理を行う", async () => {
    await vi.resetModules();
    pdfLibMocks.pdfLibMockFactory.mockClear();
    pdfLibMocks.mocks.PDFDocument.load.mockResolvedValue({
      getPages: () => [pdfLibMocks.mocks.page],
      save: async () => Uint8Array.from([1, 2, 3]),
    });
    const { savePdfWithRotation } = await import("./pdf-save");

    expect(pdfLibMocks.pdfLibMockFactory).not.toHaveBeenCalled();

    const buffer = new Uint8Array([7, 8]).buffer;
    await savePdfWithRotation(buffer, { 1: 90 }, { fileName: "lazy.pdf" });

    expect(pdfLibMocks.pdfLibMockFactory).toHaveBeenCalledTimes(1);
    expect(pdfLibMocks.mocks.PDFDocument.load).toHaveBeenCalledWith(buffer);
    expect(pdfLibMocks.mocks.degrees).toHaveBeenCalledWith(90);
    expect(pdfLibMocks.mocks.page.setRotation).toHaveBeenCalledWith(90);
  });
});
