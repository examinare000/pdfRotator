import type { FC } from "react";

type HeaderProps = {
  fileName: string;
  onReset: () => void;
  onHelpOpen: () => void;
};

export const Header: FC<HeaderProps> = ({ fileName, onReset, onHelpOpen }) => {
  return (
    <header className="app__header">
      <div className="brand">
        <div className="brand__eyebrow">
          <span className="dot" />
          <span>Precision PDF Lab</span>
        </div>
        <h1>PDFビューワ & 回転スタジオ</h1>
        <p className="sub">
          直感的なUIとショートカットでページを回転。OCRで向きを推定し、保存までノンストップ。
        </p>
        <div className="badges">
          <span className="pill pill--ghost">矢印キー操作</span>
          <span className="pill pill--ghost">OCR向き推定</span>
          <span className="pill pill--ghost">ローカル保存</span>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" onClick={onHelpOpen} aria-label="ヘルプを開く">
          ヘルプ
        </button>
        <div className="file-chip">
          <span className="chip-label">選択中</span>
          <span className="chip-value">{fileName || "未選択"}</span>
        </div>
        <button className="reset-btn" onClick={onReset}>
          状態をリセット
        </button>
      </div>
    </header>
  );
};
