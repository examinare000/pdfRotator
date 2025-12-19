import { describe, expect, it, vi } from "vitest";
import { fetchHealth } from "./health";

describe("fetchHealth", () => {
  it("health情報（version/ocrEnabled）を取得できる", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "ok",
        version: "1.2.3",
        ocrEnabled: false,
      }),
    })) as unknown as typeof fetch;

    const result = await fetchHealth({ fetcher, baseUrl: "http://localhost:3001" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ version: "1.2.3", ocrEnabled: false });
  });

  it("HTTPエラーの場合は null を返す", async () => {
    const fetcher = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    const result = await fetchHealth({ fetcher, baseUrl: "http://localhost:3001" });
    expect(result).toBeNull();
  });
});
