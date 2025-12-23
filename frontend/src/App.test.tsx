import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App";
import type { PdfDocumentProxy, PdfPageProxy } from "./lib/pdf";

const mockDetectOrientationForPage = vi.fn();
const mockUseViewerState = vi.fn();
const mockCreatePdfJsDistLoader = vi.fn();
const mockFetchHealth = vi.fn();

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

vi.mock("./lib/health", () => {
  return {
    fetchHealth: (...args: unknown[]) => mockFetchHealth(...args),
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
  selectedPages: number[];
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
    selectedPages: [],
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

const waitForAutoOcr = async (expectedCalls: number) => {
  if (expectedCalls <= 0) return;
  await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(expectedCalls));
  mockDetectOrientationForPage.mockClear();
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
    rotatePage: vi.fn(),
    setZoom: vi.fn(),
    reset: vi.fn(),
  };
};

describe("App", () => {
  beforeEach(() => {
    mockDetectOrientationForPage.mockReset();
    mockDetectOrientationForPage.mockImplementation(async (_doc: unknown, page: number) => ({
      page,
      rotation: null,
      confidence: 0,
      processingMs: 1,
      success: true,
      viewport: { width: 100, height: 100 },
    }));
    mockUseViewerState.mockReset();
    mockCreatePdfJsDistLoader.mockReset();
    mockCreatePdfJsDistLoader.mockReturnValue({ loadFromArrayBuffer: vi.fn() });
    mockFetchHealth.mockReset();
    mockFetchHealth.mockResolvedValue({ version: "1.0.0", ocrEnabled: true });
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

  it("初期状態ではアップロードとビューの主要要素が表示される", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);

    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    expect(screen.getByText("PDFアップロード")).toBeInTheDocument();
    expect(screen.getAllByText("OCR向き推定").length).toBeGreaterThan(0);
    expect(screen.getByText("回転")).toBeInTheDocument();
    expect(screen.getByText("ショートカット")).toBeInTheDocument();
    expect(screen.getByText("PDFを読み込むとここに表示されます")).toBeInTheDocument();
  });

  it("PDF未読み込み時は保存ボタンが無効になる", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);

    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "適用して保存 (Ctrl+S)" })).toBeDisabled();
  });

  it("ロード中は再選択ボタンが無効になる", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "loading" }),
      })
    );
    render(<App />);

    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "元PDFを再選択" })).toBeDisabled();
  });

  it("OCRが無効な場合はボタンを無効化し説明を表示する", async () => {
    mockFetchHealth.mockResolvedValue({ version: "1.0.0", ocrEnabled: false });
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("OCRが無効化されています（`OCR_ENABLED=false`）。")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "向き推定" })).toBeDisabled();
  });

  it("PDF読み込み時に全ページの向き推定を自動実行する", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 3, currentPage: 1, pdfDoc: createMockPdfDoc(3) }),
      })
    );

    render(<App />);

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(3));
    expect(mockDetectOrientationForPage.mock.calls[0][1]).toBe(1);
    expect(mockDetectOrientationForPage.mock.calls[1][1]).toBe(2);
    expect(mockDetectOrientationForPage.mock.calls[2][1]).toBe(3);
  });

  it("向き推定を実行できる", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(1);

    mockDetectOrientationForPage.mockResolvedValue({
      page: 1,
      rotation: 90,
      confidence: 0.91,
      processingMs: 12,
      success: true,
      viewport: { width: 100, height: 100 },
    });

    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(1));
    const [, , options] = mockDetectOrientationForPage.mock.calls[0];
    expect(options).toMatchObject({});
  });

  it("向き推定ボタンで全ページを推定して提案を自動適用する", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({
        status: "ready",
        numPages: 3,
        currentPage: 2,
        pdfDoc: createMockPdfDoc(),
        rotationMap: { 1: 90 },
      }),
    });

    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(3);

    mockDetectOrientationForPage
      .mockResolvedValueOnce({
        page: 1,
        rotation: 180,
        confidence: 0.91,
        processingMs: 12,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 2,
        rotation: 90,
        confidence: 0.92,
        processingMs: 10,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 3,
        rotation: 90,
        confidence: 0.9,
        processingMs: 8,
        success: true,
        viewport: { width: 100, height: 100 },
      });

    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(3));
    expect(mockDetectOrientationForPage.mock.calls[0][1]).toBe(1);
    expect(mockDetectOrientationForPage.mock.calls[1][1]).toBe(2);
    expect(mockDetectOrientationForPage.mock.calls[2][1]).toBe(3);

    expect(viewerHook.rotatePage).toHaveBeenCalledWith(1, 90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(3, 90);
  });

  it("選択ページがある場合はそのページのみ向き推定する", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({
        status: "ready",
        numPages: 4,
        currentPage: 1,
        pdfDoc: createMockPdfDoc(),
        rotationMap: { 2: 90 },
        selectedPages: [],
      }),
    });

    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(4);

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
        page: 4,
        rotation: 90,
        confidence: 0.92,
        processingMs: 10,
        success: true,
        viewport: { width: 100, height: 100 },
      });

    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 2" }), { button: 0 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 4" }), { button: 0 });

    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(2));
    expect(mockDetectOrientationForPage.mock.calls[0][1]).toBe(2);
    expect(mockDetectOrientationForPage.mock.calls[1][1]).toBe(4);

    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 90);
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(4, 90);
  });

  it("複数ページ推定が完了すると完了メッセージを表示する", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("2ページの向き推定が完了しました")).toBeInTheDocument();
    });
  });

  it("処理中止すると再開ボタンが有効になる", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(2);

    let resolveFirst: (value: unknown) => void = () => {};
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockDetectOrientationForPage.mockImplementationOnce(() => firstPromise);

    await user.click(screen.getByRole("button", { name: "向き推定" }));

    expect(await screen.findByRole("button", { name: "処理中止" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "処理中止" }));

    resolveFirst({
      page: 1,
      rotation: null,
      confidence: 0,
      processingMs: 1,
      success: true,
      viewport: { width: 100, height: 100 },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "処理再開" })).toBeEnabled();
    });
  });

  it("連続回転が有効な場合は同方向の高尤度ページに挟まれたページも回転する", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 3, currentPage: 1, pdfDoc: createMockPdfDoc(3) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(3);

    viewerHook.rotatePage.mockClear();
    mockDetectOrientationForPage
      .mockResolvedValueOnce({
        page: 1,
        rotation: 90,
        confidence: 0.95,
        processingMs: 12,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 2,
        rotation: null,
        confidence: 0,
        processingMs: 10,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 3,
        rotation: 90,
        confidence: 0.95,
        processingMs: 8,
        success: true,
        viewport: { width: 100, height: 100 },
      });

    await user.click(screen.getByRole("checkbox", { name: /連続回転/ }));
    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(3));
    expect(viewerHook.rotatePage).toHaveBeenCalledWith(2, 90);
  });

  it("連続回転の間に別方向の高尤度ページがある場合は回転しない", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 4, currentPage: 1, pdfDoc: createMockPdfDoc(4) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);
    const user = userEvent.setup();
    await waitForAutoOcr(4);

    viewerHook.rotatePage.mockClear();
    mockDetectOrientationForPage
      .mockResolvedValueOnce({
        page: 1,
        rotation: 90,
        confidence: 0.95,
        processingMs: 12,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 2,
        rotation: 180,
        confidence: 0.95,
        processingMs: 10,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 3,
        rotation: null,
        confidence: 0,
        processingMs: 8,
        success: true,
        viewport: { width: 100, height: 100 },
      })
      .mockResolvedValueOnce({
        page: 4,
        rotation: 90,
        confidence: 0.95,
        processingMs: 8,
        success: true,
        viewport: { width: 100, height: 100 },
      });

    await user.click(screen.getByRole("checkbox", { name: /連続回転/ }));
    await user.click(screen.getByRole("button", { name: "向き推定" }));

    await waitFor(() => expect(mockDetectOrientationForPage).toHaveBeenCalledTimes(4));
    expect(viewerHook.rotatePage).not.toHaveBeenCalledWith(3, 90);
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

  it("入力フォーカス中はショートカット回転しない", async () => {
    const viewerHook = makeViewerHook({
      state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
    });
    mockUseViewerState.mockReturnValue(viewerHook);

    render(<App />);

    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 1" }), { button: 0 });
    const fileInput = screen.getByLabelText("ファイルを選択");
    fileInput.focus();

    fireEvent.keyDown(fileInput, { key: "ArrowRight", ctrlKey: true });
    expect(viewerHook.rotatePage).not.toHaveBeenCalled();
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

  it("新しいPDFを読み込むと選択状態をリセットする", async () => {
    const loadFromArrayBuffer = vi.fn(async () => {});
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        loadFromArrayBuffer,
        state: makeState({ status: "ready", numPages: 2, currentPage: 1, pdfDoc: createMockPdfDoc(2) }),
      })
    );

    render(<App />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "ページ 1" }), { button: 0 });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "true");
    });

    const dropzone = screen.getByLabelText("PDFをドラッグ&ドロップ");
    const file = new File([new Uint8Array([1, 2, 3])], "sample.pdf", { type: "application/pdf" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(loadFromArrayBuffer).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "ページ 1" })).toHaveAttribute("aria-pressed", "false");
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

  it("プレビュー上でPDFをドロップすると読み込みできる", async () => {
    const loadFromArrayBuffer = vi.fn(async () => {});
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        loadFromArrayBuffer,
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const pageButton = screen.getByRole("button", { name: "ページ 1" });

    await user.dblClick(pageButton);
    const preview = await screen.findByRole("dialog", { name: "プレビュー" });

    const file = new File([new Uint8Array([1, 2, 3])], "sample.pdf", { type: "application/pdf" });
    fireEvent.drop(preview, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(loadFromArrayBuffer).toHaveBeenCalledTimes(1));
  });

  it("ヘルプモーダルはTabでフォーカスを閉じ込める", async () => {
    mockUseViewerState.mockReturnValue(makeViewerHook());
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "ヘルプを開く" }));

    const closeButton = await screen.findByRole("button", { name: "閉じる" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
  });

  it("プレビューモーダルはTabでフォーカスを閉じ込める", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc: createMockPdfDoc() }),
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const pageButton = screen.getByRole("button", { name: "ページ 1" });

    await user.dblClick(pageButton);
    const closeButton = await screen.findByRole("button", { name: "閉じる" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
  });

  it("サムネイルは仮想スクロールで必要分のみ描画する", async () => {
    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 200, currentPage: 1, pdfDoc: createMockPdfDoc(200) }),
      })
    );
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    render(<App />);

    const grid = document.querySelector(".viewer__grid") as HTMLDivElement;
    Object.defineProperty(grid, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(grid, "clientHeight", { value: 520, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(grid, "scrollTop", {
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
      configurable: true,
    });

    fireEvent.scroll(grid);

    const pageButtons = screen.getAllByRole("button", { name: /ページ \d+/ });
    expect(pageButtons.length).toBeLessThan(200);
    expect(pageButtons.length).toBe(12);
    expect(screen.getByRole("button", { name: "ページ 1" })).toBeInTheDocument();

    grid.scrollTop = 272 * 50;
    fireEvent.scroll(grid);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "ページ 1" })).not.toBeInTheDocument();
    });

    rafSpy.mockRestore();
  });

  it("同一サムネイルは連続描画を直列化する", async () => {
    const renderPageToCanvas = (await import("./lib/pdf")).renderPageToCanvas as unknown as vi.Mock;
    renderPageToCanvas.mockReset();
    let active = 0;
    let maxActive = 0;
    const page = {
      getViewport: vi.fn(() => ({ width: 100, height: 100 })),
    };
    const pdfDoc = {
      numPages: 1,
      getPage: vi.fn(async () => page),
    } as PdfDocumentProxy;

    renderPageToCanvas.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { width: 100, height: 100 };
    });

    mockUseViewerState.mockReturnValue(
      makeViewerHook({
        state: makeState({ status: "ready", numPages: 1, currentPage: 1, pdfDoc }),
      })
    );

    render(<App />);

    await waitFor(() => expect(renderPageToCanvas).toHaveBeenCalled());
    await waitFor(() => expect(maxActive).toBe(1));
  });
});
