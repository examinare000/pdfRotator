import { describe, expect, it } from "vitest";
import { normalizeSelectedPages } from "./selection";

describe("normalizeSelectedPages", () => {
  it("無効な値を除外して昇順ユニークにする", () => {
    const result = normalizeSelectedPages([1, 2, 2, 6, -1, 3.9, Number.NaN], 5);
    expect(result).toEqual([1, 2, 3]);
  });

  it("ページ数が0以下なら空配列にする", () => {
    expect(normalizeSelectedPages([1, 2, 3], 0)).toEqual([]);
  });
});
