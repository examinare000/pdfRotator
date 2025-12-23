import { describe, expect, it } from "vitest";
import { createRequestId } from "../src/utils/request-id";

describe("createRequestId", () => {
  it("識別子が指定形式で生成される", () => {
    const value = createRequestId();

    expect(value).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("複数回呼び出しで値が変わる", () => {
    const first = createRequestId();
    const second = createRequestId();

    expect(first).not.toBe(second);
  });
});
