import type { FC, RefObject, ChangeEvent, DragEvent } from "react";

type UploadPanelProps = {
  dragging: boolean;
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onReselect: () => void;
  disabled: boolean;
};

export const UploadPanel: FC<UploadPanelProps> = ({
  dragging,
  onDragEnter,
  onDragLeave,
  onDrop,
  fileInputRef,
  onFileChange,
  onReselect,
  disabled,
}) => (
  <section className="panel upload">
    <div
      className={`upload__area ${dragging ? "upload__area--dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label="PDFをドラッグ&ドロップ"
    >
      <div>
        <p className="label">PDFアップロード</p>
        <p className="hint">50MB以内のPDF。ドラッグ&ドロップまたは選択で読み込みます。</p>
      </div>
      <div className="upload__controls">
        <label className="upload__btn">
          <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onFileChange} />
          ファイルを選択
        </label>
        <button type="button" onClick={onReselect} disabled={disabled}>
          元PDFを再選択
        </button>
      </div>
    </div>
  </section>
);
