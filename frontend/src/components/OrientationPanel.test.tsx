import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrientationPanel } from "./OrientationPanel";

afterEach(() => {
  cleanup();
});

describe("OrientationPanel", () => {
  it("OCR結果を表示して適用ボタンでコールバックを呼ぶ", async () => {
    const user = userEvent.setup();
    const fetchOrientation = vi.fn().mockResolvedValue({
      success: true,
      rotation: 180,
      confidence: 0.82,
      processingMs: 120,
    });
    const getPageImage = vi.fn().mockResolvedValue("data:image/png;base64,xxx");
    const onApply = vi.fn();

    render(
      <OrientationPanel
        pageNumber={2}
        getPageImage={getPageImage}
        fetchOrientation={fetchOrientation}
        onApply={onApply}
        defaultThreshold={0.65}
      />
    );

    await user.click(screen.getByRole("button", { name: "OCRで向きを提案" }));

    await screen.findByText(/推定角度/);
    expect(fetchOrientation).toHaveBeenCalledWith({
      imageBase64: "data:image/png;base64,xxx",
      threshold: 0.65,
    });
    expect(screen.getByText("180°")).toBeInTheDocument();
    expect(screen.getByText("信頼度: 82%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提案を適用" }));
    expect(onApply).toHaveBeenCalledWith(180);
  });

  it("しきい値を変更してからOCRを実行すると新しい値を使う", async () => {
    const user = userEvent.setup();
    const fetchOrientation = vi.fn().mockResolvedValue({
      success: true,
      rotation: 90,
      confidence: 0.91,
      processingMs: 80,
    });
    const getPageImage = vi.fn().mockResolvedValue("data:image/png;base64,yyy");

    render(
      <OrientationPanel
        pageNumber={1}
        getPageImage={getPageImage}
        fetchOrientation={fetchOrientation}
        onApply={vi.fn()}
        defaultThreshold={0.6}
      />
    );

    const thresholdInput = screen.getByRole("spinbutton", { name: "信頼度しきい値" });
    await user.clear(thresholdInput);
    await user.type(thresholdInput, "0.8");

    await user.click(screen.getByRole("button", { name: "OCRで向きを提案" }));

    await waitFor(() => {
      expect(fetchOrientation).toHaveBeenCalledWith({
        imageBase64: "data:image/png;base64,yyy",
        threshold: 0.8,
      });
    });
  });

  it("推定結果がnullの場合は適用ボタンを無効化する", async () => {
    const user = userEvent.setup();
    const fetchOrientation = vi.fn().mockResolvedValue({
      success: true,
      rotation: null,
      confidence: 0.4,
      processingMs: 50,
    });

    render(
      <OrientationPanel
        pageNumber={5}
        getPageImage={vi.fn().mockResolvedValue("data:image/png;base64,zzz")}
        fetchOrientation={fetchOrientation}
        onApply={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "OCRで向きを提案" }));
    await screen.findByText("信頼度: 40%");

    expect(screen.getByRole("button", { name: "提案を適用" })).toBeDisabled();
  });
});
