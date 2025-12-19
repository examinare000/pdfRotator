import type { FC } from "react";

export const ShortcutsPanel: FC = () => (
  <section className="panel shortcuts">
    <p className="label">ショートカット</p>
    <div className="shortcut-grid">
      <div className="shortcut-card">
        <span className="kbd">Ctrl/Cmd + →</span>
        <span>選択を+90° 回転</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">Ctrl/Cmd + ←</span>
        <span>選択を-90° 回転</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">Ctrl/Cmd + ↑/↓</span>
        <span>選択を180° 回転</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">Ctrl/Cmd + S</span>
        <span>回転を適用して保存</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">ドラッグ</span>
        <span>複数ページ選択</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">Esc</span>
        <span>選択解除</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">ダブルクリック</span>
        <span>ページ拡大</span>
      </div>
    </div>
  </section>
);
