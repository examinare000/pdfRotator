export const normalizeSelectedPages = (pages: number[], numPages: number): number[] => {
  if (numPages < 1) return [];
  const uniquePages = new Set<number>();
  for (const page of pages) {
    if (!Number.isFinite(page)) continue;
    const normalized = Math.trunc(page);
    if (normalized < 1 || normalized > numPages) continue;
    uniquePages.add(normalized);
  }
  return Array.from(uniquePages).sort((a, b) => a - b);
};
