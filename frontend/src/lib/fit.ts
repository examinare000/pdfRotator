export type FitToWidthInput = {
  currentZoom: number;
  canvasWidth: number;
  containerWidth: number;
  padding?: number;
};

export const computeFitToWidthZoom = (input: FitToWidthInput): number | null => {
  if (!Number.isFinite(input.currentZoom) || input.currentZoom <= 0) return null;
  if (!Number.isFinite(input.canvasWidth) || input.canvasWidth <= 0) return null;
  if (!Number.isFinite(input.containerWidth) || input.containerWidth <= 0) return null;

  const padding = Number.isFinite(input.padding) ? Math.max(0, input.padding ?? 0) : 0;
  const targetWidth = input.containerWidth - padding;
  if (targetWidth <= 0) return null;

  return input.currentZoom * (targetWidth / input.canvasWidth);
};

