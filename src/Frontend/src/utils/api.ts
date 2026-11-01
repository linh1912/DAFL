/**
 * Lớp gọi API dùng chung (CN v5 — JWT).
 *
 * - Token JWT (hạn 1 giờ, CN-02) lưu ở localStorage key `dafl_token`.
 * - Mọi request qua `apiFetch`/`apiJson` đều tự gắn `Authorization: Bearer <token>`.
 * - Gặp HTTP 401 (thiếu/hết hạn token) → xóa token và gọi handler đã đăng ký
 *   (App đăng ký handler để chuyển về màn hình đăng nhập kèm
 *   `session-expired-notice` "Phiên đăng nhập đã hết hạn" — CN-02 E3).
 */

export const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || '';

export const TOKEN_STORAGE_KEY = 'dafl_token';
export const GUEST_CART_STORAGE_KEY = 'dafl_guest_cart';

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export const getToken = (): string | null => {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string | null): void => {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* bỏ qua lỗi storage (private mode) */
  }
};

export const clearToken = (): void => setToken(null);

/** Handler xử lý khi phiên hết hạn (401) — App đăng ký 1 lần khi mount. */
let sessionExpiredHandler: (() => void) | null = null;
export const setSessionExpiredHandler = (handler: (() => void) | null): void => {
  sessionExpiredHandler = handler;
};

export const handleUnauthorized = (): void => {
  clearToken();
  if (sessionExpiredHandler) {
    try {
      sessionExpiredHandler();
    } catch {
      /* handler không được làm hỏng luồng API */
    }
  }
};

/**
 * fetch có gắn JWT. Trả Response gốc để caller tự đọc body.
 * Tự xử lý 401: xóa token + báo handler (trừ khi `skipAuthHandler`).
 */
export const apiFetch = async (
  path: string,
  options: RequestInit & { skipAuthHandler?: boolean } = {}
): Promise<Response> => {
  const { skipAuthHandler, ...init } = options;
  const headers = new Headers(init.headers || {});
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && !skipAuthHandler) {
    handleUnauthorized();
  }
  return response;
};

/** Gọi API và parse ApiResponse<T>; không throw khi HTTP lỗi (trả body đã parse nếu có). */
export const apiJson = async <T>(
  path: string,
  options: RequestInit & { skipAuthHandler?: boolean } = {}
): Promise<{ status: number; body: ApiResponse<T> | null }> => {
  const response = await apiFetch(path, options);
  let body: ApiResponse<T> | null = null;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

/** Sinh Idempotency-Key ổn định cho một phiên checkout (CN-07 E5). */
export const newIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
