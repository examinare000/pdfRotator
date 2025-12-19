import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App";
import type { PdfDocumentProxy, PdfPageProxy } from "./lib/pdf";

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

vi.mock("./lib/pdf", async () => {
  const actual = await vi.importActual<typeof import("./lib/pdf")>("./lib/pdf");
  return {
    ...actual,
    renderPageToCanvas: vi.fn(async () => ({ width: 1, height: 1 })),
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

const createMockPage = (): PdfPageProxy => ({
  getViewport: vi.fn(() => ({ width: 1, height: 1 })),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
});

const createMockPdfDoc = (numPages = 1): PdfDocumentProxy => ({
  numPages,
  getPage: vi.fn(async () => createMockPage()),
});

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
    rotatePage: vi.fn(),
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

  it("DnDで300MB超のPDFをドロップするとエラーメッセージを表示する", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);

    const dropzone = screen.getByLabelText("PDFをドラッグ&ドロップ");
    const file = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 300 * 1024 * 1024 + 1 });

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    const messages = await screen.findAllByText("ファイルサイズは300MB以内にしてください");
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
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
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

  it("向き推定ボタンで現在ページ以降を推定して提案を自動適用する", async () => {
    mockDetectOrientationForPage
      .mockResolvedValueOnce({
        page: 2,
        rotation: 180,
        confidence: 0.91,
        processingMs: 12,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 3,
        rotation: 90,
        confidence: 0.92,
        processingMs: 10,
        success: true,
        viewport: { width: 100, height: 100 },
      });

    const viewerHook = makeViewerHook({
      state: makeState({
        status: "ready",
        numPages: 3,
        currentPage: 2,
        pdfDoc: createMockPdfDoc(),
        rotationMap: { 2: 90 },
      }),
    });

    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(2));
    expect(mockDetectOrientationForPage.mock.calls[0][1]).toBe(2);
    expect(mockDetectOrientationForPage.mock.calls[1][1]).toBe(3);

    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(3, 90);
  });

  it("Ctrl+左右で選択ページを回転する", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 3, currentPage: 1, pdfDoc: createMockPdfDoc(3) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 1" }), { button: 0 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 2" }), { button: 0 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "ページ 2" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(1, 90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 90);

    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(1, -90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, -90);
  });

  it("Ctrl+上下で選択ページを180度回転し、Escで選択解除できる", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 1" }), { button: 0 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 2" }), { button: 0 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "ページ 2" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(1, 180);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 180);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "ページ 2" })).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("ドラッグで複数ページを選択できる", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 3, currentPage: 1, pdfDoc: createMockPdfDoc(3) }),
      })
    );

    render(<App />);

    const page1 = screen.getByRole("button", { name: "ページ 1" });
    const page2 = screen.getByRole("button", { name: "ページ 2" });
    const page3 = screen.getByRole("button", { name: "ページ 3" });

    fireEvent.pointerDown(page1, { button: 0 });
    fireEvent.pointerEnter(page2, { buttons: 1 });
    fireEvent.pointerEnter(page3, { buttons: 1 });

    await waitFor(() => {
      expect(page1).toHaveAttribute("aria-pressed", "true");
      expect(page2).toHaveAttribute("aria-pressed", "true");
      expect(page3).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("選択解除ボタンで選択状態をクリアできる", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
      })
    );

    render(<App />);
    const user = userEvent.setup();

    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 1" }), { button: 0 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 2" }), { button: 0 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "ページ 2" })).toHaveAttribute("aria-pressed", "true");
    });

    await user.click(screen.getByRole("button", { name: "選択解除" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "ページ 2" })).toHaveAttribute("aria-pressed", "false");
    });
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

  it("ダブルクリックでプレビューを開き、Escで閉じても選択を維持する", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const pageButton = screen.getByRole("button", { name: "ページ 1" });

    fireEvent.pointerDown(pageButton, { button: 0 });
    await waitFor(() => expect(pageButton).toHaveAttribute("aria-pressed", "true"));

    await user.dblClick(pageButton);
    expect(await screen.findByRole("dialog", { name: "プレビュー" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "プレビュー" })).not.toBeInTheDocument());
    expect(pageButton).toHaveAttribute("aria-pressed", "true");
  });

  it("プレビューの閉じるボタンでモーダルを閉じられる", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const pageButton = screen.getByRole("button", { name: "ページ 1" });

    await user.dblClick(pageButton);
    expect(await screen.findByRole("dialog", { name: "プレビュー" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "閉じる" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "プレビュー" })).not.toBeInTheDocument());
  });
});
