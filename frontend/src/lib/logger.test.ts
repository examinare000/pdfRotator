import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logClient } from "./logger";

describe("logClient", () => {
  const originalSendBeacon = navigator.sendBeacon;
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: originalSendBeacon,
      configurable: true,
    });
    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  });

  it("sendBeacon が使える場合は sendBeacon を使う", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });

    logClient("error", "client_error", { page: 1 });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/logs");
  });

  it("sendBeacon が無い場合は fetch を使う", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;

    logClient("warn", "client_warn", { feature: "ocr" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/logs");
  });

  it("sendBeacon と fetch が無い場合でも例外を出さない", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
    });
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;

    expect(() => logClient("info", "client_info")).not.toThrow();
  });
});
