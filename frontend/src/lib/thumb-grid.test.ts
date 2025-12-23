import { describe, expect, it } from "vitest";
import { calculateThumbGridWindow } from "./thumb-grid";

describe("calculateThumbGridWindow", () => {
  it("必要なページ番号とパディングを計算する", () => {
    const result = calculateThumbGridWindow({
      numPages: 10,
      containerWidth: 500,
      viewportHeight: 400,
      scrollTop: 0,
      rowHeight: 200,
      minWidth: 100,
      gridGap: 10,
      gridPadding: 10,
      rowBuffer: 1,
    });

    expect(result.pageNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.paddingTop).toBe(0);
    expect(result.paddingBottom).toBe(0);
  });

  it("スクロール位置に応じて表示範囲をずらす", () => {
    const result = calculateThumbGridWindow({
      numPages: 10,
      containerWidth: 500,
      viewportHeight: 210,
      scrollTop: 210,
      rowHeight: 200,
      minWidth: 100,
      gridGap: 10,
      gridPadding: 10,
      rowBuffer: 0,
    });

    expect(result.pageNumbers).toEqual([5, 6, 7, 8, 9, 10]);
    expect(result.paddingTop).toBe(210);
  });

  it("コンテナサイズが0のときはフォールバックを使う", () => {
    const result = calculateThumbGridWindow({
      numPages: 4,
      containerWidth: 0,
      viewportHeight: 0,
      scrollTop: 0,
      rowHeight: 100,
      minWidth: 90,
      gridGap: 10,
      gridPadding: 10,
      rowBuffer: 0,
      fallbackWidth: 300,
      fallbackHeight: 200,
    });

    expect(result.pageNumbers).toEqual([1, 2, 3, 4]);
  });
});
