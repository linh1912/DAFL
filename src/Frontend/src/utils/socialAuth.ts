/**
 * Hạ tầng đăng nhập mạng xã hội (Luồng 6 — bản chốt v4).
 *
 * - Cấu hình công khai lấy từ GET /api/auth/social/config (chỉ chứa ClientId /
 *   AppId công khai và các cờ bật/tắt — không chứa secret).
 * - Google: Google Identity Services (GIS) → id_token.
 * - Facebook: Facebook JS SDK → access_token.
 * - Khi provider chưa cấu hình thật mà mock được bật (Development/Testing),
 *   FE dùng panel đồng ý giả lập trong trang thay cho popup nhà cung cấp.
 */

export type SocialProviderKey = 'google' | 'facebook';

export const SOCIAL_PROVIDER_LABEL: Record<SocialProviderKey, string> = {
  google: 'Google',
  facebook: 'Facebook',
};

/** Người dùng mẫu cố định của panel mock (Mục 9.5). */
export const SOCIAL_MOCK_USERS: Record<SocialProviderKey, { fullName: string; email: string }> = {
  google: { fullName: 'Google Test User', email: 'google.test@dafl.vn' },
  facebook: { fullName: 'Facebook Test User', email: 'facebook.test@dafl.vn' },
};

export interface SocialConfig {
  googleClientId: string | null;
  facebookAppId: string | null;
  googleEnabled: boolean;
  facebookEnabled: boolean;
  mockEnabled: boolean;
}

/**
 * Cấu hình dự phòng khi không gọi được BE: ở bản build Development thì bật
 * mock để luồng vẫn chạy/test được; bản production thì ẩn hết nút social.
 */
export const FALLBACK_SOCIAL_CONFIG: SocialConfig = {
  googleClientId: null,
  facebookAppId: null,
  googleEnabled: false,
  facebookEnabled: false,
  mockEnabled: Boolean(import.meta.env.DEV),
};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeSocialConfig = (raw: unknown): SocialConfig => {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, any>;
  const google = (data.google && typeof data.google === 'object' ? data.google : {}) as Record<string, any>;
  const facebook = (data.facebook && typeof data.facebook === 'object' ? data.facebook : {}) as Record<string, any>;

  const googleClientId =
    asString(data.googleClientId) ?? asString(data.GoogleClientId) ?? asString(google.clientId) ?? asString(google.ClientId);
  const facebookAppId =
    asString(data.facebookAppId) ?? asString(data.FacebookAppId) ?? asString(facebook.appId) ?? asString(facebook.AppId);

  return {
    googleClientId,
    facebookAppId,
    googleEnabled: Boolean(data.googleEnabled ?? google.enabled ?? googleClientId),
    facebookEnabled: Boolean(data.facebookEnabled ?? facebook.enabled ?? facebookAppId),
    mockEnabled: Boolean(data.mockEnabled ?? data.socialMockEnabled ?? false),
  };
};

export const fetchSocialConfig = async (apiBase: string): Promise<SocialConfig> => {
  try {
    const res = await fetch(`${apiBase}/api/auth/social/config`, { credentials: 'include' });
    const json = await res.json();
    const config = normalizeSocialConfig(json);
    // Phản hồi rỗng/không đúng dạng (ví dụ data là mảng) → coi như chưa cấu hình.
    if (!config.googleClientId && !config.facebookAppId && !config.googleEnabled && !config.facebookEnabled && !config.mockEnabled) {
      return FALLBACK_SOCIAL_CONFIG;
    }
    return config;
  } catch {
    return FALLBACK_SOCIAL_CONFIG;
  }
};

/** Provider dùng luồng thật khi đã có ClientId/AppId tương ứng. */
export const isSocialRealMode = (config: SocialConfig, provider: SocialProviderKey): boolean =>
  provider === 'google' ? Boolean(config.googleClientId) : Boolean(config.facebookAppId);

/** Provider dùng panel mock khi chưa cấu hình thật nhưng mock đang bật. */
export const isSocialMockMode = (config: SocialConfig, provider: SocialProviderKey): boolean =>
  !isSocialRealMode(config, provider) && config.mockEnabled;

/** Nút provider hiển thị khi chạy được thật hoặc mock (Mục 9.4/9.5). */
export const isSocialProviderVisible = (config: SocialConfig, provider: SocialProviderKey): boolean =>
  isSocialRealMode(config, provider) || isSocialMockMode(config, provider);

// ---------------------------------------------------------------------------
// Nạp SDK của nhà cung cấp (nạp một lần, dùng lại promise)
// ---------------------------------------------------------------------------

const scriptPromises = new Map<string, Promise<void>>();

const loadScriptOnce = (id: string, src: string): Promise<void> => {
  const existing = scriptPromises.get(id);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('No document'));
      return;
    }
    const previous = document.getElementById(id) as HTMLScriptElement | null;
    if (previous) {
      previous.addEventListener('load', () => resolve());
      previous.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      // Nếu script đã nạp xong từ trước thì sự kiện load không phát lại.
      window.setTimeout(() => resolve(), 1500);
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
  scriptPromises.set(id, promise);
  return promise;
};

export type SocialSignInResult =
  | { type: 'token'; token: string }
  | { type: 'cancelled' }
  | { type: 'error' };

// ---------------------------------------------------------------------------
// Google Identity Services
// ---------------------------------------------------------------------------

export const signInWithGoogleSdk = (clientId: string): Promise<SocialSignInResult> =>
  new Promise(resolve => {
    let settled = false;
    const settle = (result: SocialSignInResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    loadScriptOnce('dafl-google-gsi', 'https://accounts.google.com/gsi/client')
      .then(() => {
        const google = (window as any).google;
        if (!google?.accounts?.id) {
          settle({ type: 'error' });
          return;
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (response?.credential) {
              settle({ type: 'token', token: response.credential });
            } else {
              settle({ type: 'error' });
            }
          },
        });
        google.accounts.id.prompt((notification: any) => {
          if (!notification) return;
          if (typeof notification.isNotDisplayed === 'function' && notification.isNotDisplayed()) {
            settle({ type: 'error' });
          } else if (typeof notification.isSkippedMoment === 'function' && notification.isSkippedMoment()) {
            settle({ type: 'cancelled' });
          } else if (typeof notification.isDismissedMoment === 'function' && notification.isDismissedMoment()) {
            settle({ type: 'cancelled' });
          }
        });
        // Phòng trường hợp GIS không hề phản hồi (môi trường chặn bên thứ ba).
        window.setTimeout(() => settle({ type: 'error' }), 60000);
      })
      .catch(() => settle({ type: 'error' }));
  });

// ---------------------------------------------------------------------------
// Facebook JS SDK
// ---------------------------------------------------------------------------

export const signInWithFacebookSdk = (appId: string): Promise<SocialSignInResult> =>
  new Promise(resolve => {
    let settled = false;
    const settle = (result: SocialSignInResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    loadScriptOnce('dafl-facebook-jssdk', 'https://connect.facebook.net/vi_VN/sdk.js')
      .then(() => {
        const FB = (window as any).FB;
        if (!FB?.login) {
          settle({ type: 'error' });
          return;
        }
        try {
          FB.init({ appId, cookie: true, xfbml: false, version: 'v19.0' });
        } catch {
          // FB.init có thể đã được gọi trước đó — bỏ qua và dùng tiếp.
        }
        FB.login(
          (response: any) => {
            const accessToken = response?.authResponse?.accessToken;
            if (accessToken) {
              settle({ type: 'token', token: accessToken });
            } else {
              settle({ type: 'cancelled' });
            }
          },
          { scope: 'email,public_profile' }
        );
        window.setTimeout(() => settle({ type: 'error' }), 60000);
      })
      .catch(() => settle({ type: 'error' }));
  });
