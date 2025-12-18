import type { FC } from "react";

type FooterProps = {
  version: string;
};

export const Footer: FC<FooterProps> = ({ version }) => (
  <footer className="app__footer">
    <span className="footer-item">PDF Rotator</span>
    <span className="footer-item">{version}</span>
    <span className="footer-item">→/←: 回転+次ページ</span>
    <span className="footer-item">Ctrl/Cmd+S: 保存</span>
  </footer>
);
