import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PdfDocumentProxy } from "../lib/pdf";
import { useViewerState } from "./useViewerState";

const makeDoc = (numPages = 3): PdfDocumentProxy => ({
  numPages,
  getPage: vi.fn(),
});

const makeLoader = (doc: PdfDocumentProxy) => ({
  loadFromArrayBuffer: vi.fn().mockResolvedValue(doc),
});

describe("useViewerState", () => {
  it("初期状態はidleでページ1、回転マップは空", () => {
    const { result } = renderHook(() => useViewerState());

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.currentPage).toBe(1);
    expect(result.current.state.numPages).toBe(0);
    expect(result.current.state.rotationMap).toEqual({});
  });

  it("文書をロードするとreadyになりページ1に移動する", () => {
    const { result } = renderHook(() => useViewerState());

    act(() => result.current.loadDocument(makeDoc(2)));

    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.numPages).toBe(2);
    expect(result.current.state.currentPage).toBe(1);
  });

  it("ArrayBufferロード成功時にreadyになる", async () => {
    const doc = makeDoc(4);
    const loader = makeLoader(doc);
    const buffer = new Uint8Array([1, 2]).buffer;
    const { result } = renderHook(() => useViewerState({ loader }));

    await act(async () => {
      await result.current.loadFromArrayBuffer(buffer);
    });

    expect(loader.loadFromArrayBuffer).toHaveBeenCalledWith(buffer, undefined);
    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.numPages).toBe(4);
    expect(result.current.state.errorMessage).toBeNull();
  });

  it("ArrayBufferロード失敗時はerrorになる", async () => {
    const loader = {
      loadFromArrayBuffer: vi.fn().mockRejectedValue(new Error("読み込み失敗")),
    };
    const buffer = new Uint8Array([1]).buffer;
    const { result } = renderHook(() => useViewerState({ loader }));

    await act(async () => {
      await result.current.loadFromArrayBuffer(buffer);
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.errorMessage).toBe("読み込み失敗");
    expect(result.current.state.pdfDoc).toBeNull();
  });

  it("ページ数が0以下の文書はエラーにする", () => {
    const { result } = renderHook(() => useViewerState());

    expect(() => result.current.loadDocument(makeDoc(0))).toThrow("総ページ数は1以上のPDFのみ読み込めます");
  });

  it("ページ移動は範囲外をクランプする", () => {
    const { result } = renderHook(() => useViewerState());
    act(() => result.current.loadDocument(makeDoc(5)));

    act(() => result.current.setPage(10));
    expect(result.current.state.currentPage).toBe(5);

    act(() => result.current.setPage(0));
    expect(result.current.state.currentPage).toBe(1);
  });

  it("next/prevで境界を超えない", () => {
    const { result } = renderHook(() => useViewerState());
    act(() => result.current.loadDocument(makeDoc(2)));

    act(() => result.current.prevPage());
    expect(result.current.state.currentPage).toBe(1);

    act(() => result.current.nextPage());
    act(() => result.current.nextPage());
    expect(result.current.state.currentPage).toBe(2);
  });

  it("現在ページを90度単位で回転し、360度で0に戻る", () => {
    const { result } = renderHook(() => useViewerState());
    act(() => result.current.loadDocument(makeDoc(3)));
    act(() => result.current.setPage(2));

    act(() => result.current.rotateCurrentPage(90));
    act(() => result.current.rotateCurrentPage(90));
    act(() => result.current.rotateCurrentPage(180));

    expect(result.current.state.rotationMap[2]).toBe(0);
  });

  it("zoomは下限・上限でクランプする", () => {
    const { result } = renderHook(() => useViewerState());

    act(() => result.current.setZoom(10));
    expect(result.current.state.zoom).toBe(3);

    act(() => result.current.setZoom(0.1));
    expect(result.current.state.zoom).toBe(0.25);
  });

  it("resetで初期状態に戻す", () => {
    const { result } = renderHook(() => useViewerState());
    act(() => result.current.loadDocument(makeDoc(2)));
    act(() => result.current.rotateCurrentPage(90));

    act(() => result.current.reset());

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.rotationMap).toEqual({});
    expect(result.current.state.pdfDoc).toBeNull();
  });
});
