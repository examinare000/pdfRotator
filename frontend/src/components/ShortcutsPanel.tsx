import type { FC } from "react";

export const ShortcutsPanel: FC = () => (
  <section className="panel shortcuts">
    <p className="label">ショートカット</p>
    <div className="shortcut-grid">
      <div className="shortcut-card">
        <span className="kbd">→</span>
        <span>+90° 回転して次ページ</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">←</span>
        <span>-90° 回転して次ページ</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">↓ / ↑</span>
        <span>ページ移動</span>
      </div>
      <div className="shortcut-card">
        <span className="kbd">Ctrl/Cmd + S</span>
        <span>回転を適用して保存</span>
      </div>
    </div>
  </section>
);
