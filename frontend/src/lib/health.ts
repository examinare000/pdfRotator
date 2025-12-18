export type HealthInfo = {
  version: string;
  ocrEnabled: boolean;
};

export const fetchHealth = async (options?: {
  fetcher?: typeof fetch;
  baseUrl?: string;
}): Promise<HealthInfo | null> => {
  const fetcher = options?.fetcher ?? (globalThis.fetch as typeof fetch | undefined);
  if (!fetcher) return null;
  const baseUrl = options?.baseUrl ?? window.location.href;
  const url = new URL("/api/health", baseUrl);

  const res = await fetcher(url.toString(), { method: "GET" });
  if (!res.ok) return null;

  const json = (await res.json()) as unknown as Partial<HealthInfo> & { status?: string };
  if (typeof json?.version !== "string") return null;
  if (typeof json?.ocrEnabled !== "boolean") return null;

  return { version: json.version, ocrEnabled: json.ocrEnabled };
};
