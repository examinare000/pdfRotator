import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App";

const mockDetectOrientationForPage = vi.fn();
const mockUseViewerState = vi.fn();
const mockCreatePdfJsDistLoader = vi.fn();

vi.mock("./lib/ocr", async () => {
  const actual = await vi.importActual<typeof import("./lib/ocr")>("./lib/ocr");
  return {
    ...actual,
    detectOrientationForPage: (...args: unknown[]) => mockDetectOrientationForPage(...args),
  };
});

vi.mock("./hooks/useViewerState", () => {
  return {
    useViewerState: (...args: unknown[]) => mockUseViewerState(...args),
  };
});

vi.mock("./lib/pdfjs", () => {
  return {
    createPdfJsDistLoader: (...args: unknown[]) => mockCreatePdfJsDistLoader(...args),
  };
});

type MockViewerState = {
  status: "idle" | "loading" | "ready" | "error";
  pdfDoc: unknown;
  numPages: number;
  currentPage: number;
  rotationMap: Record<number, 0 | 90 | 180 | 270>;
  zoom: number;
  errorMessage: string | null;
};

const makeState = (override?: Partial<MockViewerState>): MockViewerState => {
  const base = {
    status: "idle" as MockViewerState["status"],
    pdfDoc: null,
    numPages: 0,
    currentPage: 1,
    rotationMap: {},
    zoom: 1,
    errorMessage: null,
  };
  return { ...base, ...override };
};

const makeViewerHook = (override?: {
  state?: MockViewerState;
  loadFromArrayBuffer?: () => Promise<void>;
  setPage?: (page: number) => void;
}) => {
  const loadFromArrayBuffer = override?.loadFromArrayBuffer ?? vi.fn(async () => {});
  const setPage = override?.setPage ?? vi.fn();
  return {
    state: override?.state ?? makeState(),
    loadFromArrayBuffer,
    setPage,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    rotateCurrentPage: vi.fn(),
    setZoom: vi.fn(),
    reset: vi.fn(),
  };
};

describe("App", () => {
  beforeEach(() => {
    mockDetectOrientationForPage.mockReset();
    mockUseViewerState.mockReset();
    mockCreatePdfJsDistLoader.mockReset();
    mockCreatePdfJsDistLoader.mockReturnValue({ loadFromArrayBuffer: vi.fn() });
  });

  it("DnDでPDF以外をドロップするとエラーメッセージを表示する", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);

    const dropzone = screen.getByLabelText("PDFをドラッグ&ドロップ");
    const file = new File(["hello"], "note.txt", { type: "text/plain" });

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    const messages = await screen.findAllByText("PDFファイルを選択してください");
    expect(messages.length).toBeGreaterThan(0);
  });

  it("DnDで50MB超のPDFをドロップするとエラーメッセージを表示する", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);

    const dropzone = screen.getByLabelText("PDFをドラッグ&ドロップ");
    const file = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    const messages = await screen.findAllByText("ファイルサイズは50MB以内にしてください");
    expect(messages.length).toBeGreaterThan(0);
  });

  it("DnDで有効なPDFをドロップすると読み込み処理を実行する", async () => {
    const loadFromArrayBuffer = vi.fn(async () => {});
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        loadFromArrayBuffer,
      })
    );
    render(<App />);

    const dropzone = screen.getByLabelText("PDFをドラッグ&ドロップ");
    const file = new File([new Uint8Array([1, 2, 3])], "sample.pdf", { type: "application/pdf" });

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(loadFromArrayBuffer).toHaveBeenCalledTimes(1));
    expect(screen.getByText("sample.pdf")).toBeInTheDocument();
  });

  it("ページ番号入力で範囲外を指定しても総ページ数にクランプして移動する", async () => {
    const setPage = vi.fn();
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 5, currentPage: 1, pdfDoc: {} as any }),
        setPage,
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("ページ番号入力"));
    await user.type(screen.getByLabelText("ページ番号入力"), "999");
    await user.click(screen.getByRole("button", { name: "移動" }));

    expect(setPage).toHaveBeenCalledWith(5);
  });

  it("OCRしきい値を指定して向き推定を実行できる", async () => {
    mockDetectOrientationForPage.mockResolvedValue({
      page: 1,
      rotation: 90,
      confidence: 0.91,
      processingMs: 12,
      success: true,
      viewport: { width: 100, height: 100 },
    });

    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: {} as any }),
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("OCR信頼度しきい値"));
    await user.type(screen.getByLabelText("OCR信頼度しきい値"), "0.8");
    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(1));
    const [, , options] = mockDetectOrientationForPage.mock.calls[0];
    expect(options).toMatchObject({ threshold: 0.8 });
  });

  it("ヘルプモーダルを開閉できる", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "ヘルプを開く" }));
    expect(await screen.findByRole("dialog", { name: "ヘルプ" })).toBeInTheDocument();
    expect(screen.getAllByText("ショートカット").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ヘルプ" })).not.toBeInTheDocument());
  });
});
