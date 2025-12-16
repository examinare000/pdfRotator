import { describe, expect, it } from "vitest";
import { applyRotationChange, clampPageNumber, getPageRotation, normalizeRotation } from "./rotation";

describe("normalizeRotation", () => {
  it("90度単位で0/90/180/270に正規化する", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(810)).toBe(90);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it("90度単位でない値はエラーを投げる", () => {
    expect(() => normalizeRotation(45)).toThrow("回転角は90度単位である必要があります");
    expect(() => normalizeRotation(NaN)).toThrow("回転角は90度単位である必要があります");
  });
});

describe("applyRotationChange", () => {
  it("未設定のページは0度から差分を適用する", () => {
    const original = {};
    const updated = applyRotationChange(original, 2, 90);

    expect(updated[2]).toBe(90);
    expect(original).toEqual({});
  });

  it("360度を超える場合は0度に戻る", () => {
    const updated = applyRotationChange({ 1: 270 }, 1, 90);
    expect(updated[1]).toBe(0);
  });

  it("負の差分でも正規化して適用する", () => {
    const updated = applyRotationChange({ 3: 90 }, 3, -450);
    expect(updated[3]).toBe(0);
  });

  it("90度単位でない差分はエラーを投げる", () => {
    expect(() => applyRotationChange({}, 1, 30)).toThrow("回転角は90度単位である必要があります");
  });
});

describe("getPageRotation", () => {
  it("未設定のページは0度を返す", () => {
    expect(getPageRotation({}, 1)).toBe(0);
  });

  it("設定済みのページは正規化して返す", () => {
    expect(getPageRotation({ 2: 450 }, 2)).toBe(90);
    expect(getPageRotation({ 5: -90 }, 5)).toBe(270);
  });

  it("90度単位でない値が含まれていればエラーを投げる", () => {
    expect(() => getPageRotation({ 1: 45 }, 1)).toThrow("回転角は90度単位である必要があります");
  });
});

describe("clampPageNumber", () => {
  it("ページ番号を1..総ページ数の範囲に丸める", () => {
    expect(clampPageNumber(0, 10)).toBe(1);
    expect(clampPageNumber(5, 10)).toBe(5);
    expect(clampPageNumber(15, 10)).toBe(10);
  });

  it("総ページ数が1未満の場合はエラーを投げる", () => {
    expect(() => clampPageNumber(1, 0)).toThrow("総ページ数は1以上である必要があります");
  });
});
