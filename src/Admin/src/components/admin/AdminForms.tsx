import React, { useEffect, useRef, useState } from 'react';
import { discountPercent, parseMoney, randomPromoCode, slugify } from './formUtils';
import { CategoryPicker, FieldError, FormShell, ImageUploader, MoneyInput, Req, Toggle, imageItemFromUrl } from './FormControls';
import type { UploadImageItem } from './FormControls';

/**
 * 3 form admin đợt redesign (drawer/modal + upload ảnh).
 * Mỗi form tự giữ state field + validate realtime (blur) + khi bấm Lưu;
 * chỉ gọi onSave(payload) khi dữ liệu hợp lệ. onSave trả { ok, error } —
 * lỗi server hiện trong form, không đóng form, giữ nguyên dữ liệu.
 * Đóng form (ESC / X / Hủy) đi qua onRequestClose(dirty): cha quyết định
 * có hỏi "chưa lưu" không (dùng ConfirmDialog có sẵn ở AdminPage).
 */

// ---------- Helper dùng chung ----------

/** Cuộn tới + focus ô lỗi đầu tiên (tìm theo testid trong form). */
const focusField = (formTestid: string, fieldTestid: string) => {
  const el = document.querySelector(
    `[data-testid="${formTestid}"] [data-testid="${fieldTestid}"]`,
  ) as HTMLElement | null;
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  el?.focus();
};

const focusFirstError = (formTestid: string, errors: Record<string, string>, order: string[], testidOf: Record<string, string>) => {
  const first = order.find(f => errors[f]);
  if (first) focusField(formTestid, testidOf[first]);
};

/** Tiêu đề nhóm field trong form. */
const FormSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="sa-form-section">
    <h4 className="sa-form-section-title">{title}</h4>
    {children}
  </div>
);

// ============================================================================
// 1. FORM SẢN PHẨM — Drawer
// ============================================================================

export interface ProductFormInitial {
  id: string; name: string; categoryId: string; price: string; originalPrice: string;
  stock: string; description: string; imageUrl: string; isActive: boolean;
}

export interface ProductSavePayload {
  id: string; name: string; categoryId: string; price: number; originalPrice: number | null;
  stock: number; description: string; imageUrl: string; imageUrls: string[]; isActive: boolean;
}

const PRODUCT_ERROR_TESTID: Record<string, string> = {
  name: 'admin-product-name-input',
  categoryId: 'admin-product-category-select',
  price: 'admin-product-price-input',
  originalPrice: 'admin-product-original-price-input',
  stock: 'admin-product-stock-input',
};

export function ProductForm({ initial, categories, onSave, onRequestClose }: {
  initial: ProductFormInitial;
  categories: Array<{ id: string; name: string }>;
  onSave: (payload: ProductSavePayload) => Promise<{ ok: boolean; error?: string }>;
  onRequestClose: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [price, setPrice] = useState(initial.price.replace(/\D/g, ''));
  const [originalPrice, setOriginalPrice] = useState(initial.originalPrice.replace(/\D/g, ''));
  const [stock, setStock] = useState(initial.stock.replace(/\D/g, ''));
  const [description, setDescription] = useState(initial.description);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [images, setImages] = useState<UploadImageItem[]>(() =>
    initial.imageUrl ? [imageItemFromUrl(initial.imageUrl)] : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const readyUrls = images.filter(i => i.status === 'ready' && i.url).map(i => i.url);
  const initialUrls = initial.imageUrl ? [initial.imageUrl] : [];
  const dirty =
    name !== initial.name || categoryId !== initial.categoryId || price !== initial.price.replace(/\D/g, '') ||
    originalPrice !== initial.originalPrice.replace(/\D/g, '') || stock !== initial.stock.replace(/\D/g, '') ||
    description !== initial.description || isActive !== initial.isActive ||
    JSON.stringify(readyUrls) !== JSON.stringify(initialUrls);

  // Textarea mô tả tự giãn chiều cao theo nội dung.
  useEffect(() => {
    const el = descRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [description]);

  const validateAll = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const n = name.trim();
    if (n.length < 3 || n.length > 120) errs.name = 'Tên sản phẩm phải có từ 3 đến 120 ký tự.';
    if (!categoryId) errs.categoryId = 'Vui lòng chọn danh mục.';
    const p = parseMoney(price);
    if (!(p > 0)) errs.price = 'Giá bán phải lớn hơn 0.';
    if (originalPrice !== '') {
      const op = parseMoney(originalPrice);
      if (!(op > p)) errs.originalPrice = 'Giá gốc phải lớn hơn giá bán.';
    }
    const s = stock === '' ? NaN : Number(stock);
    if (!Number.isInteger(s) || s < 0) errs.stock = 'Tồn kho phải là số nguyên ≥ 0.';
    return errs;
  };

  const validateField = (field: string) => {
    const errs = validateAll();
    setErrors(prev => {
      const next = { ...prev };
      if (errs[field]) next[field] = errs[field];
      else delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs = validateAll();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError('admin-product-form', errs,
        ['name', 'categoryId', 'price', 'originalPrice', 'stock'], PRODUCT_ERROR_TESTID);
      return;
    }
    setSubmitting(true);
    const res = await onSave({
      id: initial.id,
      name: name.trim(),
      categoryId,
      price: parseMoney(price),
      originalPrice: originalPrice === '' ? null : parseMoney(originalPrice),
      stock: Number(stock),
      description,
      imageUrl: readyUrls[0] ?? '',
      imageUrls: readyUrls,
      isActive,
    });
    setSubmitting(false);
    if (!res.ok) setFormError(res.error || 'Không lưu được sản phẩm.');
    // Thành công: cha đóng form + toast + reload (form unmount, không cần làm gì thêm).
  };

  const priceNum = parseMoney(price);
  const origNum = originalPrice === '' ? null : parseMoney(originalPrice);
  const pct = discountPercent(Number.isNaN(priceNum) ? 0 : priceNum, origNum);
  const stockNum = stock === '' ? 0 : Number(stock);
  const categoryName = categories.find(c => c.id === categoryId)?.name ?? '';

  return (
    <FormShell
      variant="drawer"
      title={initial.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}
      subtitle={initial.id ? 'Chỉnh sửa thông tin sản phẩm đang bán.' : 'Thêm sản phẩm mới lên sàn.'}
      testid="admin-product-form-modal"
      formTestid="admin-product-form"
      onRequestClose={() => onRequestClose(dirty)}
      onSubmit={handleSubmit}
      footer={(
        <>
          <button type="button" className="sa-btn sa-btn-ghost" data-testid="admin-product-cancel-btn" onClick={() => onRequestClose(dirty)}>
            Hủy
          </button>
          <button type="submit" className="sa-btn" data-testid="admin-product-save-btn" disabled={submitting}>
            {submitting ? 'Đang lưu...' : initial.id ? 'Lưu thay đổi' : 'Lưu'}
          </button>
        </>
      )}
    >
      {formError && <p className="sa-error" role="alert">{formError}</p>}
      <FormSection title="Thông tin cơ bản">
        <div className="sa-form-grid">
          <div className="sa-field sa-field-wide">
            <label className="sa-field-label" htmlFor="admin-product-name">Tên sản phẩm<Req /></label>
            <input
              id="admin-product-name"
              className={`sa-input${errors.name ? ' sa-input-error' : ''}`}
              value={name}
              data-testid="admin-product-name-input"
              aria-describedby={errors.name ? 'admin-product-name-error' : undefined}
              onChange={e => setName(e.target.value)}
              onBlur={() => validateField('name')}
            />
            <span className="sa-field-meta">
              <span className="sa-hint">Từ 3 đến 120 ký tự.</span>
              <span className="sa-count" data-testid="admin-product-name-count">{name.length}/120</span>
            </span>
            <FieldError id="admin-product-name-error" testid="admin-product-name-error" message={errors.name} />
          </div>
          <div className="sa-field sa-field-wide">
            <label className="sa-field-label" htmlFor="admin-product-category">Danh mục<Req /></label>
            <CategoryPicker
              value={categoryId}
              categories={categories}
              onChange={v => {
                setCategoryId(v);
                // Xóa lỗi ngay khi đã chọn (validateField đọc state cũ trong cùng event nên không dùng ở đây).
                if (v) setErrors(prev => { const n = { ...prev }; delete n.categoryId; return n; });
              }}
              testid="admin-product-category-select"
              errorId={errors.categoryId ? 'admin-product-category-error' : undefined}
            />
            <FieldError id="admin-product-category-error" testid="admin-product-category-error" message={errors.categoryId} />
          </div>
        </div>
      </FormSection>
      <FormSection title="Giá & tồn kho">
        <div className="sa-form-grid">
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-product-price">Giá bán<Req /></label>
            <MoneyInput
              id="admin-product-price"
              value={price}
              onChange={v => setPrice(v)}
              testid="admin-product-price-input"
              errorId={errors.price ? 'admin-product-price-error' : undefined}
            />
            <span className="sa-field-meta"><span className="sa-hint">Giá bán phải lớn hơn 0.</span></span>
            <FieldError id="admin-product-price-error" testid="admin-product-price-error" message={errors.price} />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-product-original-price">Giá gốc</label>
            <MoneyInput
              id="admin-product-original-price"
              value={originalPrice}
              onChange={v => setOriginalPrice(v)}
              testid="admin-product-original-price-input"
              errorId={errors.originalPrice ? 'admin-product-original-price-error' : undefined}
            />
            <span className="sa-field-meta">
              <span className="sa-hint">Không bắt buộc; phải lớn hơn giá bán.</span>
              {pct !== null && <span className="sa-discount-badge" data-testid="admin-product-discount-badge">Giảm {pct}%</span>}
            </span>
            <FieldError id="admin-product-original-price-error" testid="admin-product-original-price-error" message={errors.originalPrice} />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-product-stock">Tồn kho<Req /></label>
            <span className="sa-stepper">
              <button
                type="button"
                className="sa-stepper-btn"
                data-testid="admin-product-stock-minus-btn"
                aria-label="Giảm tồn kho"
                onClick={() => setStock(String(Math.max(0, stockNum - 1)))}
              >
                −
              </button>
              <input
                id="admin-product-stock"
                className={`sa-input sa-stepper-input${errors.stock ? ' sa-input-error' : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={stock}
                data-testid="admin-product-stock-input"
                aria-describedby={errors.stock ? 'admin-product-stock-error' : undefined}
                onChange={e => setStock(e.target.value.replace(/\D/g, ''))}
                onBlur={() => validateField('stock')}
              />
              <button
                type="button"
                className="sa-stepper-btn"
                data-testid="admin-product-stock-plus-btn"
                aria-label="Tăng tồn kho"
                onClick={() => setStock(String(stockNum + 1))}
              >
                +
              </button>
            </span>
            <span className="sa-field-meta"><span className="sa-hint">Số nguyên ≥ 0.</span></span>
            <FieldError id="admin-product-stock-error" testid="admin-product-stock-error" message={errors.stock} />
          </div>
          <div className="sa-field">
            <span className="sa-field-label">Trạng thái</span>
            <Toggle
              checked={isActive}
              onChange={setIsActive}
              testid="admin-product-status-toggle"
              label={isActive ? 'Hiển thị / Đang bán' : 'Đang ẩn'}
            />
            <span className="sa-field-meta"><span className="sa-hint">Tắt để ẩn sản phẩm khỏi sàn.</span></span>
          </div>
        </div>
      </FormSection>
      <FormSection title="Hình ảnh">
        <ImageUploader prefix="admin-product-image" images={images} onChange={setImages} multiple max={8} />
        <p className="sa-hint">Kéo-thả thumbnail để đổi thứ tự — ảnh đầu tiên là ảnh chính. Bấm ★ để đặt ảnh chính.</p>
      </FormSection>
      <FormSection title="Mô tả">
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="admin-product-description">Mô tả</label>
          <textarea
            ref={descRef}
            id="admin-product-description"
            className="sa-input sa-textarea-auto"
            rows={3}
            value={description}
            data-testid="admin-product-description-input"
            onChange={e => setDescription(e.target.value)}
          />
          <span className="sa-field-meta">
            <span className="sa-hint">Mô tả chi tiết sản phẩm.</span>
            <span className="sa-count" data-testid="admin-product-description-count">{description.length}/2000</span>
          </span>
        </div>
      </FormSection>
      <FormSection title="Xem trước">
        <div className="sa-product-preview" data-testid="admin-product-preview">
          {readyUrls[0]
            ? <img src={readyUrls[0]} alt="" className="sa-preview-img" />
            : <span className="sa-preview-img sa-preview-ph" aria-hidden="true">🛍️</span>}
          <span className="sa-preview-info">
            <strong>{name.trim() || 'Tên sản phẩm'}</strong>
            <small>{categoryName || 'Chưa chọn danh mục'}</small>
            <span className="sa-preview-price">
              <span className="sa-money">{Number.isNaN(priceNum) || priceNum <= 0 ? '—' : `${priceNum.toLocaleString('vi-VN')}đ`}</span>
              {origNum !== null && origNum > 0 && <s>{origNum.toLocaleString('vi-VN')}đ</s>}
              {pct !== null && <span className="sa-discount-badge">Giảm {pct}%</span>}
            </span>
            <small>Tồn kho: {stock === '' ? '—' : stockNum}</small>
          </span>
        </div>
      </FormSection>
    </FormShell>
  );
}

// ============================================================================
// 2. FORM DANH MỤC — Modal 560px
// ============================================================================

export interface CategoryFormInitial {
  id: string; name: string; description: string; sortOrder: string;
  isActive: boolean; slug: string; iconUrl: string;
}

export interface CategorySavePayload {
  id: string; name: string; description: string; sortOrder: number;
  isActive: boolean; slug: string; iconUrl: string;
}

const CATEGORY_ERROR_TESTID: Record<string, string> = {
  name: 'admin-category-name-input',
  slug: 'admin-category-slug-input',
};

export function CategoryForm({ initial, onSave, onRequestClose }: {
  initial: CategoryFormInitial;
  onSave: (payload: CategorySavePayload) => Promise<{ ok: boolean; error?: string }>;
  onRequestClose: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(initial.name);
  // Khi sửa: giữ slug hiện có, không tự sinh đè. Khi tạo: tự sinh từ tên
  // cho tới khi người dùng sửa slug tay thì dừng.
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(initial.id !== '');
  const [description, setDescription] = useState(initial.description);
  const [sortOrder, setSortOrder] = useState(initial.sortOrder);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [images, setImages] = useState<UploadImageItem[]>(() =>
    initial.iconUrl ? [imageItemFromUrl(initial.iconUrl)] : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const iconUrl = images.filter(i => i.status === 'ready' && i.url).map(i => i.url)[0] ?? '';
  const dirty =
    name !== initial.name || slug !== initial.slug || description !== initial.description ||
    sortOrder !== initial.sortOrder || isActive !== initial.isActive || iconUrl !== initial.iconUrl;

  const validateAll = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const n = name.trim();
    if (n.length < 2 || n.length > 150) errs.name = 'Tên danh mục phải có từ 2 đến 150 ký tự.';
    if (slug !== '' && !/^[a-z0-9-]+$/.test(slug)) errs.slug = 'Slug chỉ gồm chữ thường, số và gạch ngang.';
    return errs;
  };

  const validateField = (field: string) => {
    const errs = validateAll();
    setErrors(prev => {
      const next = { ...prev };
      if (errs[field]) next[field] = errs[field];
      else delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs = validateAll();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError('admin-category-form', errs, ['name', 'slug'], CATEGORY_ERROR_TESTID);
      return;
    }
    setSubmitting(true);
    const res = await onSave({
      id: initial.id,
      name: name.trim(),
      description,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      slug: slug.trim(),
      iconUrl,
    });
    setSubmitting(false);
    if (!res.ok) setFormError(res.error || 'Không lưu được danh mục.');
  };

  return (
    <FormShell
      variant="modal"
      title={initial.id ? 'Sửa danh mục' : 'Thêm danh mục'}
      subtitle={initial.id ? 'Chỉnh sửa thông tin danh mục.' : 'Thêm danh mục mới cho sàn.'}
      testid="admin-category-form-modal"
      formTestid="admin-category-form"
      onRequestClose={() => onRequestClose(dirty)}
      onSubmit={handleSubmit}
      footer={(
        <>
          <button type="button" className="sa-btn sa-btn-ghost" data-testid="admin-category-cancel-btn" onClick={() => onRequestClose(dirty)}>
            Hủy
          </button>
          <button type="submit" className="sa-btn" data-testid="admin-category-save-btn" disabled={submitting}>
            {submitting ? 'Đang lưu...' : initial.id ? 'Lưu thay đổi' : 'Lưu'}
          </button>
        </>
      )}
    >
      {formError && <p className="sa-error" role="alert">{formError}</p>}
      <FormSection title="Thông tin cơ bản">
        <div className="sa-form-grid">
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-category-name">Tên danh mục<Req /></label>
            <input
              id="admin-category-name"
              className={`sa-input${errors.name ? ' sa-input-error' : ''}`}
              value={name}
              data-testid="admin-category-name-input"
              aria-describedby={errors.name ? 'admin-category-name-error' : undefined}
              onChange={e => {
                const v = e.target.value;
                setName(v);
                if (!slugEdited) setSlug(slugify(v));
              }}
              onBlur={() => validateField('name')}
            />
            <span className="sa-field-meta"><span className="sa-hint">Từ 2 đến 150 ký tự.</span></span>
            <FieldError id="admin-category-name-error" testid="admin-category-name-error" message={errors.name} />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-category-slug">Slug</label>
            <input
              id="admin-category-slug"
              className={`sa-input${errors.slug ? ' sa-input-error' : ''}`}
              value={slug}
              data-testid="admin-category-slug-input"
              aria-describedby={errors.slug ? 'admin-category-slug-error' : undefined}
              onChange={e => { setSlug(e.target.value); setSlugEdited(true); }}
              onBlur={() => validateField('slug')}
            />
            <span className="sa-field-meta"><span className="sa-hint">Tự sinh từ tên — sửa tay để giữ slug riêng.</span></span>
            <FieldError id="admin-category-slug-error" testid="admin-category-slug-error" message={errors.slug} />
          </div>
          <div className="sa-field sa-field-wide">
            <label className="sa-field-label" htmlFor="admin-category-description">Mô tả</label>
            <input
              id="admin-category-description"
              className="sa-input"
              value={description}
              data-testid="admin-category-description-input"
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-category-sort-order">Thứ tự sắp xếp</label>
            <input
              id="admin-category-sort-order"
              className="sa-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={sortOrder}
              data-testid="admin-category-sort-order-input"
              onChange={e => setSortOrder(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <span className="sa-field-meta"><span className="sa-hint">Số càng nhỏ càng hiện trước.</span></span>
          </div>
          <div className="sa-field">
            <span className="sa-field-label">Trạng thái</span>
            <Toggle
              checked={isActive}
              onChange={setIsActive}
              testid="admin-category-status-toggle"
              label={isActive ? 'Hiển thị' : 'Đang ẩn'}
            />
          </div>
        </div>
      </FormSection>
      <FormSection title="Hình ảnh">
        <ImageUploader prefix="admin-category-image" images={images} onChange={setImages} multiple={false} max={1} />
      </FormSection>
    </FormShell>
  );
}

// ============================================================================
// 3. FORM KHUYẾN MÃI — Modal 560px (KHÔNG có field ảnh: backend không có entity nào chứa ảnh khuyến mãi)
// ============================================================================

export interface PromoFormInitial {
  id: string; code: string; description: string; discountType: string; discountValue: string;
  minOrderAmount: string; maxDiscountAmount: string; startDate: string; expiryDate: string;
  maxUses: string; maxUsesPerUser: string; minTier: string; scopeType: string;
  scopeCategoryId: string; scopeProductIds: string;
}

export interface PromoSavePayload extends PromoFormInitial {
  /** Chỉ ở chế độ tạo: kích hoạt ngay sau khi tạo thành công. */
  activateNow: boolean;
}

const PROMO_ERROR_TESTID: Record<string, string> = {
  code: 'admin-promo-code-input',
  discountValue: 'admin-promo-value-input',
  minOrderAmount: 'admin-promo-min-order-input',
  scope: 'admin-promo-code-input',
};

/** Ngày kết thúc ở form là <input type="date"> nên chỉ lấy phần YYYY-MM-DD. */
const toDateOnly = (s: string) => (s && s.includes('T') ? s.slice(0, 10) : s);

export function PromoForm({ initial, categories, onSave, onRequestClose }: {
  initial: PromoFormInitial;
  categories: Array<{ id: string; name: string }>;
  onSave: (payload: PromoSavePayload) => Promise<{ ok: boolean; error?: string }>;
  onRequestClose: (dirty: boolean) => void;
}) {
  const normInitial: PromoFormInitial = { ...initial, expiryDate: toDateOnly(initial.expiryDate) };
  const [code, setCode] = useState(normInitial.code);
  const [description, setDescription] = useState(normInitial.description);
  const [discountType, setDiscountType] = useState(normInitial.discountType);
  const [discountValue, setDiscountValue] = useState(normInitial.discountValue);
  const [minOrderAmount, setMinOrderAmount] = useState(normInitial.minOrderAmount.replace(/\D/g, ''));
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(normInitial.maxDiscountAmount.replace(/\D/g, ''));
  const [startDate, setStartDate] = useState(normInitial.startDate);
  const [expiryDate, setExpiryDate] = useState(normInitial.expiryDate);
  const [maxUses, setMaxUses] = useState(normInitial.maxUses);
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(normInitial.maxUsesPerUser);
  const [minTier, setMinTier] = useState(normInitial.minTier);
  const [scopeType, setScopeType] = useState(normInitial.scopeType);
  const [scopeCategoryId, setScopeCategoryId] = useState(normInitial.scopeCategoryId);
  const [scopeProductIds, setScopeProductIds] = useState(normInitial.scopeProductIds);
  const [activateNow, setActivateNow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = normInitial.id !== '';
  const dirty =
    code !== normInitial.code || description !== normInitial.description ||
    discountType !== normInitial.discountType || discountValue !== normInitial.discountValue ||
    minOrderAmount !== normInitial.minOrderAmount.replace(/\D/g, '') ||
    maxDiscountAmount !== normInitial.maxDiscountAmount.replace(/\D/g, '') ||
    startDate !== normInitial.startDate || expiryDate !== normInitial.expiryDate ||
    maxUses !== normInitial.maxUses || maxUsesPerUser !== normInitial.maxUsesPerUser ||
    minTier !== normInitial.minTier || scopeType !== normInitial.scopeType ||
    scopeCategoryId !== normInitial.scopeCategoryId || scopeProductIds !== normInitial.scopeProductIds ||
    activateNow;

  const validateAll = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const dv = Number(discountValue);
    if (!(dv > 0) || (discountType === 'Percentage' && dv > 100)) {
      errs.discountValue = 'Giá trị giảm không hợp lệ (giảm % tối đa 100).';
    }
    if (isEdit) {
      const minOrder = Number(minOrderAmount) || 0;
      if (minOrder < 0) errs.minOrderAmount = 'Đơn tối thiểu không được âm.';
      return errs;
    }
    const c = code.trim().toUpperCase();
    if (!/^[A-Za-z0-9_-]{3,50}$/.test(c)) errs.code = 'Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, từ 3 đến 50 ký tự.';
    if (scopeType === 'Category' && !scopeCategoryId) errs.scope = 'Voucher theo danh mục phải chọn danh mục.';
    if (scopeType === 'Product' && !scopeProductIds.trim()) errs.scope = 'Voucher theo sản phẩm phải chọn ít nhất 1 sản phẩm (nhập ID, cách nhau bằng dấu phẩy).';
    return errs;
  };

  const validateField = (field: string) => {
    const errs = validateAll();
    setErrors(prev => {
      const next = { ...prev };
      if (errs[field]) next[field] = errs[field];
      else delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs = validateAll();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError('admin-promo-form', errs,
        ['code', 'discountValue', 'minOrderAmount', 'scope'], PROMO_ERROR_TESTID);
      return;
    }
    setSubmitting(true);
    const res = await onSave({
      id: normInitial.id,
      code: code.trim().toUpperCase(),
      description,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      startDate,
      expiryDate,
      maxUses,
      maxUsesPerUser,
      minTier,
      scopeType,
      scopeCategoryId,
      scopeProductIds,
      activateNow: !isEdit && activateNow,
    });
    setSubmitting(false);
    if (!res.ok) setFormError(res.error || 'Không lưu được khuyến mãi.');
  };

  const discountTypeBtn = (type: string, testid: string, label: string) => (
    <button
      key={type}
      type="button"
      role="radio"
      aria-checked={discountType === type}
      data-testid={testid}
      className={`sa-segmented-btn${discountType === type ? ' sa-segmented-active' : ''}`}
      disabled={isEdit}
      onClick={() => setDiscountType(type)}
    >
      {label}
    </button>
  );

  return (
    <FormShell
      variant="modal"
      title={isEdit ? `Sửa khuyến mãi ${normInitial.code}` : 'Tạo khuyến mãi mới'}
      subtitle={isEdit
        ? 'Voucher Nháp: chỉ sửa được mô tả, giá trị giảm, đơn tối thiểu, trần giảm, ngày kết thúc và tổng lượt. Mã, loại giảm và phạm vi không đổi.'
        : 'Tạo ở trạng thái Nháp — bấm Kích hoạt để chạy.'}
      testid="admin-promo-form-modal"
      formTestid="admin-promo-form"
      onRequestClose={() => onRequestClose(dirty)}
      onSubmit={handleSubmit}
      footer={(
        <>
          <button type="button" className="sa-btn sa-btn-ghost" data-testid="admin-promo-cancel-btn" onClick={() => onRequestClose(dirty)}>
            Hủy
          </button>
          <button type="submit" className="sa-btn" data-testid="admin-promo-save-btn" disabled={submitting}>
            {submitting ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Lưu'}
          </button>
        </>
      )}
    >
      {formError && <p className="sa-error" role="alert">{formError}</p>}
      {errors.scope && <p className="sa-error" role="alert">{errors.scope}</p>}
      <FormSection title="Thông tin cơ bản">
        <div className="sa-form-grid">
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-code">Mã<Req /></label>
            <span className="sa-code-row">
              <input
                id="admin-promo-code"
                className={`sa-input${errors.code ? ' sa-input-error' : ''}`}
                value={code}
                data-testid="admin-promo-code-input"
                aria-describedby={errors.code ? 'admin-promo-code-error' : undefined}
                disabled={isEdit}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onBlur={() => validateField('code')}
              />
              {!isEdit && (
                <button type="button" className="sa-btn sa-btn-ghost" data-testid="admin-promo-generate-code-btn" onClick={() => setCode(randomPromoCode())}>
                  Tạo mã ngẫu nhiên
                </button>
              )}
            </span>
            <span className="sa-field-meta"><span className="sa-hint">3–50 ký tự: chữ, số, gạch ngang/gạch dưới. Tự viết hoa khi gõ.</span></span>
            <FieldError id="admin-promo-code-error" testid="admin-promo-code-error" message={errors.code} />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-description">Mô tả</label>
            <input
              id="admin-promo-description"
              className="sa-input"
              value={description}
              data-testid="admin-promo-description-input"
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
      </FormSection>
      <FormSection title="Giá trị giảm">
        <div className="sa-form-grid">
          <div className="sa-field">
            <span className="sa-field-label" id="admin-promo-discount-type-label">Loại giảm<Req /></span>
            <span className="sa-segmented" role="radiogroup" aria-labelledby="admin-promo-discount-type-label">
              {discountTypeBtn('Fixed', 'admin-promo-discount-type-fixed', 'Cố định')}
              {discountTypeBtn('Percentage', 'admin-promo-discount-type-percent', 'Phần trăm')}
              {discountTypeBtn('FreeShip', 'admin-promo-discount-type-freeship', 'Miễn phí ship')}
            </span>
            <span className="sa-field-meta"><span className="sa-hint">Sửa voucher Nháp không đổi được loại giảm.</span></span>
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-value">Giá trị giảm<Req /></label>
            {discountType === 'Percentage' ? (
              <span className="sa-money-wrap">
                <input
                  id="admin-promo-value"
                  className={`sa-input sa-money-input${errors.discountValue ? ' sa-input-error' : ''}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={discountValue.replace(/\D/g, '')}
                  data-testid="admin-promo-value-input"
                  aria-describedby={errors.discountValue ? 'admin-promo-value-error' : undefined}
                  onChange={e => setDiscountValue(e.target.value.replace(/\D/g, ''))}
                  onBlur={() => validateField('discountValue')}
                />
                <span className="sa-money-suffix" aria-hidden="true">%</span>
              </span>
            ) : (
              <MoneyInput
                id="admin-promo-value"
                value={discountValue.replace(/\D/g, '')}
                onChange={setDiscountValue}
                testid="admin-promo-value-input"
                errorId={errors.discountValue ? 'admin-promo-value-error' : undefined}
              />
            )}
            <span className="sa-field-meta"><span className="sa-hint">{discountType === 'Percentage' ? 'Từ 1 đến 100%.' : discountType === 'FreeShip' ? 'Miễn phí vận chuyển — giá trị 0.' : 'Số tiền giảm cố định.'}</span></span>
            <FieldError id="admin-promo-value-error" testid="admin-promo-value-error" message={errors.discountValue} />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-min-order">Đơn tối thiểu</label>
            <MoneyInput
              id="admin-promo-min-order"
              value={minOrderAmount}
              onChange={setMinOrderAmount}
              testid="admin-promo-min-order-input"
              errorId={errors.minOrderAmount ? 'admin-promo-min-order-error' : undefined}
            />
            <FieldError id="admin-promo-min-order-error" testid="admin-promo-min-order-error" message={errors.minOrderAmount} />
          </div>
          {discountType === 'Percentage' && (
            <div className="sa-field">
              <label className="sa-field-label" htmlFor="admin-promo-max-discount">Giảm tối đa</label>
              <MoneyInput
                id="admin-promo-max-discount"
                value={maxDiscountAmount}
                onChange={setMaxDiscountAmount}
                testid="admin-promo-max-discount-input"
              />
              <span className="sa-field-meta"><span className="sa-hint">Không bắt buộc.</span></span>
            </div>
          )}
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-max-uses">Số lượt dùng tối đa</label>
            <input
              id="admin-promo-max-uses"
              className="sa-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={maxUses.replace(/\D/g, '')}
              data-testid="admin-promo-max-uses-input"
              onChange={e => setMaxUses(e.target.value.replace(/\D/g, ''))}
            />
            <span className="sa-field-meta"><span className="sa-hint">Để trống = không giới hạn.</span></span>
          </div>
        </div>
      </FormSection>
      <FormSection title="Thời gian & phạm vi">
        <div className="sa-form-grid">
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-start">Ngày bắt đầu</label>
            <input
              id="admin-promo-start"
              className="sa-input"
              type="datetime-local"
              value={startDate}
              data-testid="admin-promo-start-input"
              disabled={isEdit}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-expiry">Ngày hết hạn</label>
            <input
              id="admin-promo-expiry"
              className="sa-input"
              type="date"
              value={expiryDate}
              data-testid="admin-promo-expiry-input"
              onChange={e => setExpiryDate(e.target.value)}
            />
            <span className="sa-field-meta"><span className="sa-hint">Định dạng dd/mm/yyyy.</span></span>
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-max-uses-per-user">Lượt dùng / người</label>
            <input
              id="admin-promo-max-uses-per-user"
              className="sa-input"
              type="number"
              min={1}
              value={maxUsesPerUser}
              disabled={isEdit}
              onChange={e => setMaxUsesPerUser(e.target.value)}
            />
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-min-tier">Hạng tối thiểu</label>
            <select
              id="admin-promo-min-tier"
              className="sa-input"
              value={minTier}
              disabled={isEdit}
              onChange={e => setMinTier(e.target.value)}
            >
              <option value="">Không giới hạn hạng</option>
              <option value="Member">Thường</option>
              <option value="Silver">Bạc</option>
              <option value="Gold">Vàng</option>
              <option value="Diamond">Kim cương</option>
            </select>
          </div>
          <div className="sa-field">
            <label className="sa-field-label" htmlFor="admin-promo-scope">Phạm vi áp dụng</label>
            <select
              id="admin-promo-scope"
              className="sa-input"
              value={scopeType}
              disabled={isEdit}
              onChange={e => setScopeType(e.target.value)}
            >
              <option value="All">Toàn sàn</option>
              <option value="Category">Theo danh mục</option>
              <option value="Product">Theo sản phẩm</option>
            </select>
          </div>
          {scopeType === 'Category' && (
            <div className="sa-field sa-field-wide">
              <label className="sa-field-label" htmlFor="admin-promo-scope-category">Danh mục áp dụng</label>
              <select
                id="admin-promo-scope-category"
                className="sa-input"
                value={scopeCategoryId}
                onChange={e => setScopeCategoryId(e.target.value)}
              >
                <option value="">— Chọn danh mục —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {scopeType === 'Product' && (
            <div className="sa-field sa-field-wide">
              <label className="sa-field-label" htmlFor="admin-promo-scope-products">ID sản phẩm, cách nhau bằng dấu phẩy</label>
              <input
                id="admin-promo-scope-products"
                className="sa-input"
                value={scopeProductIds}
                onChange={e => setScopeProductIds(e.target.value)}
              />
            </div>
          )}
          {!isEdit && (
            <div className="sa-field sa-field-wide">
              <span className="sa-field-label">Trạng thái</span>
              <Toggle
                checked={activateNow}
                onChange={setActivateNow}
                testid="admin-promo-status-toggle"
                label={activateNow ? 'Kích hoạt ngay sau khi tạo' : 'Tạo ở trạng thái Nháp'}
              />
            </div>
          )}
        </div>
      </FormSection>
    </FormShell>
  );
}
