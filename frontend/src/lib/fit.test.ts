import { describe, expect, it } from "vitest";
import { computeFitToWidthZoom } from "./fit";

describe("computeFitToWidthZoom", () => {
  it("キャンバス幅に対してコンテナ幅が小さい場合、ズームを下げる", () => {
    const next = computeFitToWidthZoom({
      currentZoom: 1,
      canvasWidth: 1000,
      containerWidth: 500,
      padding: 0,
    });

    expect(next).toBeCloseTo(0.5);
  });

  it("コンテナ幅に余白を差し引いて計算する", () => {
    const next = computeFitToWidthZoom({
      currentZoom: 2,
      canvasWidth: 800,
      containerWidth: 900,
      padding: 100,
    });

    expect(next).toBeCloseTo(2);
  });

  it("幅が無効な場合は null を返す", () => {
    expect(
      computeFitToWidthZoom({
        currentZoom: 1,
        canvasWidth: 0,
        containerWidth: 600,
      })
    ).toBeNull();
  });
});

