export type ThumbGridWindow = {
  pageNumbers: number[];
  paddingTop: number;
  paddingBottom: number;
};

export type ThumbGridParams = {
  numPages: number;
  containerWidth: number;
  viewportHeight: number;
  scrollTop: number;
  rowHeight: number;
  minWidth: number;
  gridGap: number;
  gridPadding: number;
  rowBuffer: number;
  fallbackWidth?: number;
  fallbackHeight?: number;
};

const resolveDimension = (value: number, fallback?: number): number => {
  if (Number.isFinite(value) && value > 0) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) return fallback;
  return 0;
};

export const calculateThumbGridWindow = (params: ThumbGridParams): ThumbGridWindow => {
  const {
    numPages,
    containerWidth,
    viewportHeight,
    scrollTop,
    rowHeight,
    minWidth,
    gridGap,
    gridPadding,
    rowBuffer,
    fallbackWidth,
    fallbackHeight,
  } = params;

  if (numPages <= 0) {
    return {
      pageNumbers: [],
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const resolvedWidth = resolveDimension(containerWidth, fallbackWidth);
  const resolvedHeight = resolveDimension(viewportHeight, fallbackHeight);
  const innerWidth = Math.max(0, resolvedWidth - gridPadding * 2);
  const columns = Math.max(1, Math.floor((innerWidth + gridGap) / (minWidth + gridGap)));
  const rowStride = rowHeight + gridGap;
  const totalRows = Math.ceil(numPages / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / rowStride) - rowBuffer);
  const endRow = Math.min(
    totalRows - 1,
    Math.floor((scrollTop + resolvedHeight) / rowStride) + rowBuffer
  );
  const startIndex = startRow * columns;
  const endIndex = Math.min(numPages, (endRow + 1) * columns);
  const pageNumbers: number[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    pageNumbers.push(index + 1);
  }

  return {
    pageNumbers,
    paddingTop: startRow * rowStride,
    paddingBottom: Math.max(0, (totalRows - endRow - 1) * rowStride),
  };
};
