import { describe, expect, it } from "vitest";
import { normalizeLogLevel, parseClientLogPayload } from "../src/utils/logs";

describe("parseClientLogPayload", () => {
  it("必須項目が欠けている場合は null を返す", () => {
    expect(parseClientLogPayload({ level: "info" })).toBeNull();
    expect(parseClientLogPayload({ message: "test" })).toBeNull();
  });

  it("型が不正な場合は null を返す", () => {
    expect(parseClientLogPayload({ level: 1, message: "test" })).toBeNull();
    expect(parseClientLogPayload({ level: "info", message: 2 })).toBeNull();
  });

  it("有効なペイロードは正規化して返す", () => {
    const result = parseClientLogPayload({
      level: "warn",
      message: "client message",
      context: { source: "ui" },
      timestamp: "2025-12-23T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      level: "warn",
      message: "client message",
      context: { source: "ui" },
      timestamp: "2025-12-23T10:00:00.000Z",
    });
  });
});

describe("normalizeLogLevel", () => {
  it("許可されたレベルはそのまま返す", () => {
    expect(normalizeLogLevel("error")).toBe("error");
    expect(normalizeLogLevel("warn")).toBe("warn");
  });

  it("未知のレベルは info にフォールバックする", () => {
    expect(normalizeLogLevel("trace")).toBe("info");
  });
});
