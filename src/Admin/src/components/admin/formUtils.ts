import { API_BASE, getToken } from '../../../../Shared/utils/api';

/**
 * Helper dùng chung cho form admin (đợt redesign form + upload ảnh).
 * Chỉ chứa hàm thuần / gọi API upload — không động vào nghiệp vụ validate
 * hay payload của từng form (nằm trong AdminForms.tsx / AdminPage.tsx).
 */

/** Bỏ dấu tiếng Việt, lowercase, nối gạch ngang — dùng sinh slug danh mục. */
export const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);

/** "319000" -> "319.000" (định dạng nghìn vi-VN, không có hậu tố đ). */
export const formatThousands = (digits: string): string => {
  const d = digits.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!d) return '';
  return Number(d).toLocaleString('vi-VN');
};

/** "319.000" / "319000" -> 319000 (số thô để gửi payload). */
export const parseMoney = (value: string): number => {
  const d = String(value ?? '').replace(/\D/g, '');
  return d === '' ? NaN : Number(d);
};

/** % giảm tự tính từ giá bán + giá gốc, null khi không tính được. */
export const discountPercent = (price: number, originalPrice: number | null): number | null => {
  if (!originalPrice || !(originalPrice > 0) || !(price > 0) || originalPrice <= price) return null;
  return Math.round((1 - price / originalPrice) * 100);
};

/** Sinh mã khuyến mãi ngẫu nhiên: 8 ký tự A-Z0-9. */
export const randomPromoCode = (length = 8): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(buf);
  else for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * chars.length);
  return Array.from(buf, n => chars[n % chars.length]).join('');
};

// ---------- Upload ảnh ----------

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 1600;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Validate client trước khi upload: định dạng + dung lượng. */
export const validateImageFile = (file: File): string | null => {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Định dạng không được hỗ trợ (chỉ PNG, JPG, WEBP).';
  if (file.size > MAX_IMAGE_BYTES) return 'Ảnh vượt quá 5MB.';
  return null;
};

/**
 * Nén/resize client trước khi gửi: cạnh dài tối đa 1600px (canvas).
 * Môi trường không có canvas 2D (vd jsdom trong Vitest) thì trả file gốc.
 */
export const compressImage = async (file: File): Promise<File> => {
  try {
    if (typeof document === 'undefined') return file;
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_EDGE) { bitmap.close?.(); return file; }
    const scale = MAX_IMAGE_EDGE / longest;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, file.type || 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name, { type: blob.type || file.type });
  } catch {
    return file;
  }
};

export interface UploadResult { ok: boolean; url?: string; error?: string }

/**
 * Upload 1 ảnh: POST /api/admin/upload, multipart/form-data, field "file".
 * Dùng XMLHttpRequest để có tiến độ upload thật (fetch không báo progress).
 * Lưu ý: KHÔNG dùng apiFetch ở đây vì nó tự gắn Content-Type: application/json
 * khi có body — FormData cần trình duyệt tự đặt boundary multipart.
 */
export const uploadImageFile = (
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> =>
  new Promise(resolve => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/admin/upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { success?: boolean; message?: string; data?: { url?: string } | string };
        const url = typeof body.data === 'string' ? body.data : body.data?.url;
        if (xhr.status >= 200 && xhr.status < 300 && url) resolve({ ok: true, url });
        else resolve({ ok: false, error: body.message || `Upload thất bại (HTTP ${xhr.status}).` });
      } catch {
        resolve({ ok: false, error: 'Máy chủ trả về phản hồi không hợp lệ.' });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: 'Không thể kết nối đến máy chủ.' });
    xhr.ontimeout = () => resolve({ ok: false, error: 'Upload quá thời gian chờ.' });
    xhr.send(form);
  });

/** Preview ngay bằng URL.createObjectURL (fallback '' khi môi trường không hỗ trợ). */
export const objectUrlOf = (file: File): string => {
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
};
