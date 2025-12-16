export type Rotation = 0 | 90 | 180 | 270;

export type PageRotationMap = Record<number, Rotation>;

const assertMultipleOf90 = (value: number): void => {
  if (!Number.isFinite(value) || value % 90 !== 0) {
    throw new Error("回転角は90度単位である必要があります");
  }
};

export const normalizeRotation = (value: number): Rotation => {
  assertMultipleOf90(value);
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  throw new Error("回転角は90度単位である必要があります");
};

export const applyRotationChange = (
  rotationMap: PageRotationMap,
  pageNumber: number,
  delta: number
): PageRotationMap => {
  assertMultipleOf90(delta);
  const current = pageNumber in rotationMap ? rotationMap[pageNumber] : 0;
  const nextRotation = normalizeRotation(current + delta);
  return { ...rotationMap, [pageNumber]: nextRotation };
};

export const getPageRotation = (rotationMap: PageRotationMap, pageNumber: number): Rotation => {
  if (!(pageNumber in rotationMap)) {
    return 0;
  }
  return normalizeRotation(rotationMap[pageNumber]);
};

export const clampPageNumber = (page: number, totalPages: number): number => {
  if (!Number.isFinite(totalPages) || totalPages < 1) {
    throw new Error("総ページ数は1以上である必要があります");
  }
  if (!Number.isFinite(page)) {
    throw new Error("ページ番号が不正です");
  }
  const pageInt = Math.trunc(page);
  if (pageInt < 1) {
    return 1;
  }
  if (pageInt > totalPages) {
    return totalPages;
  }
  return pageInt;
};
