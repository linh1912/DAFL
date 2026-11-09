import React, { useEffect, useId, useRef, useState } from 'react';
import { compressImage, formatThousands, objectUrlOf, uploadImageFile, validateImageFile } from './formUtils';

/**
 * Control dùng chung cho 3 form admin (đợt redesign form + upload ảnh).
 * Không chứa nghiệp vụ validate/payload — chỉ giao diện + tương tác.
 */

// ---------- Dòng lỗi inline dưới ô (viền đỏ ở input do class sa-input-error) ----------
export function FieldError({ id, testid, message }: { id?: string; testid?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p className="sa-field-error" id={id} data-testid={testid} role="alert">
      <span aria-hidden="true">⚠</span> {message}
    </p>
  );
}

/** Dấu * đỏ cho trường bắt buộc. */
export const Req = () => (
  <span className="sa-req" aria-hidden="true"> *</span>
);

// ---------- Toggle switch (role="switch") ----------
export function Toggle({ checked, onChange, testid, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; testid: string; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testid}
      className={`sa-toggle${checked ? ' sa-toggle-on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="sa-toggle-knob" aria-hidden="true" />
      <span className="sa-toggle-label">{label}</span>
    </button>
  );
}

// ---------- Ô tiền tệ: hiển thị dấu chấm ngăn cách nghìn + hậu tố ₫, state giữ số thô ----------
export function MoneyInput({ id, value, onChange, testid, errorId, disabled, placeholder }: {
  id: string; value: string; onChange: (digits: string) => void; testid: string;
  errorId?: string; disabled?: boolean; placeholder?: string;
}) {
  return (
    <span className="sa-money-wrap">
      <input
        id={id}
        className="sa-input sa-money-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={formatThousands(value)}
        placeholder={placeholder ?? '0'}
        aria-describedby={errorId}
        disabled={disabled}
        data-testid={testid}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
      />
      <span className="sa-money-suffix" aria-hidden="true">₫</span>
    </span>
  );
}

// ---------- Dropdown danh mục TỰ LÀM (trigger + listbox có ô tìm kiếm) ----------
export function CategoryPicker({ value, categories, onChange, testid, errorId, placeholder }: {
  value: string;
  categories: Array<{ id: string; name: string }>;
  onChange: (id: string) => void;
  testid: string;
  errorId?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = categories.find(c => c.id === value);
  const filtered = categories.filter(c => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open ]);

  return (
    <div className="sa-picker" ref={wrapRef}>
      <button
        type="button"
        className="sa-input sa-picker-trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-describedby={errorId}
        aria-label="Danh mục"
        data-testid={testid}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      >
        <span className={selected ? '' : 'sa-picker-placeholder'}>{selected ? selected.name : (placeholder ?? 'Chọn danh mục')}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sa-picker-list" role="listbox" aria-label="Danh sách danh mục">
          <input
            className="sa-input sa-picker-search"
            placeholder="Tìm danh mục..."
            value={query}
            aria-label="Tìm danh mục"
            onChange={e => setQuery(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {filtered.length === 0 && <div className="sa-picker-empty">Không tìm thấy danh mục.</div>}
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === value}
              className={`sa-picker-option${c.id === value ? ' sa-picker-selected' : ''}`}
              onClick={() => { onChange(c.id); setOpen(false); setQuery(''); }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Upload ảnh ----------

export interface UploadImageItem {
  id: string;
  /** URL ảnh đã upload xong (hoặc URL tay nhập / ảnh cũ). */
  url: string;
  /** Preview local (object URL) trong lúc chờ upload; mặc định = url. */
  previewUrl: string;
  status: 'ready' | 'uploading' | 'error';
  progress: number;
  error?: string | null;
  name?: string;
}

let imageSeq = 0;
const nextImageId = () => `img-${Date.now()}-${++imageSeq}`;

export function imageItemFromUrl(url: string): UploadImageItem {
  return { id: nextImageId(), url, previewUrl: url, status: 'ready', progress: 100 };
}

interface ImageUploaderProps {
  /** Tiền tố testid, vd "admin-product-image" / "admin-category-image". */
  prefix: string;
  images: UploadImageItem[];
  onChange: (images: UploadImageItem[]) => void;
  multiple: boolean;
  max?: number;
}

/**
 * Dropzone upload ảnh: bấm chọn file / kéo-thả / dán Ctrl+V.
 * Preview ngay (object URL), nén/resize client rồi POST /api/admin/upload
 * (field "file", trả { url }), progress % thật qua XHR, lỗi inline + Thử lại.
 * Input file thật luôn present trong DOM (visually-hidden, không display:none)
 * để Selenium sendKeys được.
 */
export function ImageUploader({ prefix, images, onChange, multiple, max }: ImageUploaderProps) {
  const maxImages = max ?? (multiple ? 8 : 1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [dropError, setDropError] = useState<string | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const patchItem = (id: string, patch: Partial<UploadImageItem>) => {
    onChange(imagesRef.current.map(it => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (!multiple && list.length > 1) setDropError('Chỉ chọn 1 ảnh cho danh mục.');
    const room = maxImages - imagesRef.current.length;
    if (room <= 0) { setDropError(`Tối đa ${maxImages} ảnh.`); return; }
    const accepted = list.slice(0, multiple ? room : 1);
    if (list.length > accepted.length) setDropError(`Tối đa ${maxImages} ảnh — chỉ nhận ${accepted.length} ảnh đầu.`);
    else setDropError(null);
    accepted.forEach(file => {
      const err = validateImageFile(file);
      const item: UploadImageItem = {
        id: nextImageId(), url: '', previewUrl: objectUrlOf(file),
        status: err ? 'error' : 'uploading', progress: 0, error: err, name: file.name,
      };
      onChange([...imagesRef.current, item]);
      if (err) return;
      void (async () => {
        const compressed = await compressImage(file);
        const res = await uploadImageFile(compressed, pct => patchItem(item.id, { progress: pct }));
        if (res.ok && res.url) patchItem(item.id, { status: 'ready', progress: 100, url: res.url, error: null });
        else patchItem(item.id, { status: 'error', error: res.error || 'Upload thất bại.' });
      })();
    });
  };

  const retryItem = (item: UploadImageItem) => {
    // Chỉ thử lại được khi còn file gốc — item lỗi validate/upload đều giữ
    // preview local nhưng không giữ File; vì vậy retry = mở lại hộp chọn file.
    // (Giữ nút Thử lại theo spec; bấm sẽ mở hộp chọn để chọn lại ảnh đó.)
    fileInputRef.current?.click();
    void item;
  };

  const removeItem = (id: string) => onChange(imagesRef.current.filter(it => it.id !== id));

  const setMain = (index: number) => {
    if (!multiple || index === 0) return;
    const next = [...imagesRef.current];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    onChange(next);
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\/.+/i.test(url)) { setDropError('Link ảnh phải bắt đầu bằng http:// hoặc https://.'); return; }
    if (imagesRef.current.length >= maxImages) { setDropError(`Tối đa ${maxImages} ảnh.`); return; }
    setDropError(null);
    onChange([...imagesRef.current, imageItemFromUrl(url)]);
    setLinkUrl('');
    setLinkOpen(false);
  };

  const thumbTestid = (i: number) => (multiple ? `${prefix}-thumb-${i}` : `${prefix}-thumb`);
  const removeTestid = (i: number) => (multiple ? `${prefix}-remove-btn-${i}` : `${prefix}-remove-btn`);

  return (
    <div className="sa-uploader">
      <div
        className={`sa-dropzone${dragOver ? ' sa-dropzone-over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Kéo thả ảnh vào đây hoặc bấm để chọn từ máy tính"
        data-testid={`${prefix}-dropzone`}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        onPaste={e => {
          const files = e.clipboardData?.files;
          if (files && files.length > 0) { e.preventDefault(); addFiles(files); }
        }}
      >
        <span className="sa-dropzone-icon" aria-hidden="true">☁️</span>
        <span className="sa-dropzone-text">Kéo thả ảnh vào đây hoặc bấm để chọn từ máy tính</span>
        <span className="sa-dropzone-sub">PNG, JPG, WEBP – tối đa 5MB{multiple ? ' – tối đa 8 ảnh' : ''}</span>
        {/* Input file thật, chỉ visually-hidden (không display:none) để Selenium sendKeys được. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple={multiple}
          className="sa-visually-hidden"
          data-testid={`${prefix}-input`}
          aria-label="Chọn ảnh từ máy tính"
          onChange={e => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
          onClick={e => e.stopPropagation()}
        />
      </div>
      {dropError && (
        <p className="sa-field-error" data-testid={`${prefix}-error`} role="alert">
          <span aria-hidden="true">⚠</span> {dropError}
        </p>
      )}
      {images.length > 0 && (
        <div className="sa-thumbs">
          {images.map((it, i) => (
            <div
              key={it.id}
              className={`sa-thumb-item${it.status === 'error' ? ' sa-thumb-error' : ''}`}
              data-testid={thumbTestid(i)}
              draggable={multiple && it.status === 'ready'}
              onDragStart={() => { dragIndexRef.current = i; }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const from = dragIndexRef.current;
                dragIndexRef.current = null;
                if (from === null || from === i) return;
                const next = [...imagesRef.current];
                const [moved] = next.splice(from, 1);
                next.splice(i, 0, moved);
                onChange(next);
              }}
            >
              {it.previewUrl
                ? <img src={it.previewUrl} alt={it.name ?? `Ảnh ${i + 1}`} className="sa-thumb-img" />
                : <span className="sa-thumb-ph" aria-hidden="true">🖼️</span>}
              {multiple && i === 0 && it.status === 'ready' && <span className="sa-thumb-main">Ảnh chính</span>}
              {it.status === 'uploading' && (
                <span className="sa-thumb-progress" data-testid={`${prefix}-progress-${i}`}>
                  <span className="sa-progress-bar"><span style={{ width: `${it.progress}%` }} /></span>
                  {it.progress}%
                </span>
              )}
              {it.status === 'error' && (
                <span className="sa-thumb-retry">
                  <span className="sa-thumb-err-text">{it.error || 'Upload thất bại.'}</span>
                  <button type="button" className="sa-btn sa-btn-ghost sa-thumb-retry-btn" onClick={() => retryItem(it)}>Thử lại</button>
                </span>
              )}
              <span className="sa-thumb-actions">
                {multiple && i !== 0 && it.status === 'ready' && (
                  <button
                    type="button"
                    className="sa-thumb-btn"
                    data-testid={`${prefix}-set-main-btn-${i}`}
                    title="Đặt làm ảnh chính"
                    aria-label={`Đặt ảnh ${i + 1} làm ảnh chính`}
                    onClick={() => setMain(i)}
                  >
                    ★
                  </button>
                )}
                <button
                  type="button"
                  className="sa-thumb-btn sa-thumb-remove"
                  data-testid={removeTestid(i)}
                  title="Xóa ảnh"
                  aria-label={`Xóa ảnh ${i + 1}`}
                  onClick={() => removeItem(it.id)}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="sa-link-btn"
        data-testid={`${prefix}-link-toggle`}
        onClick={() => setLinkOpen(v => !v)}
      >
        Hoặc dán link ảnh
      </button>
      {linkOpen && (
        <span className="sa-link-row">
          <input
            className="sa-input"
            placeholder="https://..."
            value={linkUrl}
            data-testid={`${prefix}-url-input`}
            aria-label="Link ảnh"
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
          />
          <button type="button" className="sa-btn sa-btn-ghost" onClick={addLink}>Thêm</button>
        </span>
      )}
    </div>
  );
}

// ---------- Khung form: drawer (sản phẩm) / modal lớn (danh mục, khuyến mãi) ----------

interface FormShellProps {
  variant: 'drawer' | 'modal';
  title: string;
  subtitle?: string;
  testid: string;
  formTestid: string;
  onRequestClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Drawer trượt từ phải (560–640px, mobile = bottom sheet 95vh) hoặc modal
 * max-width 560px. Dùng chung class overlay/modal của SparkModal nên nhìn
 * đồng bộ; khác SparkModal ở: header có mô tả phụ, footer sticky, ESC/X/Hủy
 * đều đi qua onRequestClose (cha quyết định có hỏi "chưa lưu" không),
 * trap focus + autofocus ô đầu tiên, không đóng khi bấm ra ngoài overlay
 * (tránh mất dữ liệu đang nhập).
 */
export function FormShell({ variant, title, subtitle, testid, formTestid, onRequestClose, onSubmit, footer, children }: FormShellProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
    // Autofocus ô nhập đầu tiên khi mở (không phải nút X ở header).
    const firstField = el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (firstField ?? focusables()[0])?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onRequestClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      prevActive?.focus?.();
    };
    // Chỉ chạy 1 lần khi mount (mở form); onRequestClose ổn định qua ref của cha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sa-modal-overlay sa-form-overlay">
      <div
        ref={containerRef}
        className={variant === 'drawer' ? 'sa-drawer' : 'sa-modal sa-modal-lg'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testid}
      >
        <form onSubmit={onSubmit} data-testid={formTestid} noValidate className="sa-form-shell">
          <div className="sa-form-head">
            <div className="sa-form-head-text">
              <h3 id={titleId}>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="sa-modal-close" onClick={onRequestClose} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className="sa-form-body">{children}</div>
          <div className="sa-form-foot">{footer}</div>
        </form>
      </div>
    </div>
  );
}
