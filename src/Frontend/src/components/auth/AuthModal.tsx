import React, { useEffect, useState } from 'react';
import { X, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import {
  SocialProviderKey,
  SOCIAL_PROVIDER_LABEL,
  SOCIAL_MOCK_USERS,
  SocialConfig,
  FALLBACK_SOCIAL_CONFIG,
  fetchSocialConfig,
  isSocialMockMode,
  isSocialRealMode,
  isSocialProviderVisible,
  signInWithGoogleSdk,
  signInWithFacebookSdk,
} from '../../utils/socialAuth';

const SOCIAL_API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const isValidVietnamesePhone = (phone: string) => /^0\d{9}$/.test(phone.trim());

const ERROR_COLOR = '#e40046';
const SUCCESS_GREEN = '#16a34a';

const fieldErrorStyle: React.CSSProperties = { color: ERROR_COLOR, fontSize: '0.8rem', marginTop: 6 };
const errorBorderStyle = (hasError: boolean): React.CSSProperties =>
  hasError ? { borderColor: ERROR_COLOR } : {};

/** Giá trị form đăng ký sau khi đã trim/validate phía client (CN-01 — KHÔNG còn ô địa chỉ). */
export interface RegisterFormValues {
  fullName: string;
  email: string;
  password: string;
  phoneNumber: string;
}

export type RegisterFieldKey = 'name' | 'email' | 'password' | 'confirmPassword' | 'phone';
export type RegisterFieldErrors = Partial<Record<RegisterFieldKey, string>>;

interface PasswordRuleListProps {
  password: string;
  testIdPrefix: string;
}

/** Checklist policy mật khẩu nghiêm ngặt (O2): ≥8 + chữ hoa + chữ số + ký tự đặc biệt, 2×2, xanh lá khi đạt. */
export const PasswordRuleList: React.FC<PasswordRuleListProps> = ({ password, testIdPrefix }) => {
  const rules = [
    { key: 'len', label: 'Tối thiểu 8 ký tự', passed: password.length >= 8 },
    { key: 'upper', label: 'Ít nhất 1 chữ hoa (A-Z)', passed: /[A-Z]/.test(password) },
    { key: 'digit', label: 'Ít nhất 1 chữ số (0-9)', passed: /\d/.test(password) },
    { key: 'special', label: 'Ít nhất 1 ký tự đặc biệt (!@#$...)', passed: /[^a-zA-Z0-9]/.test(password) },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px 12px',
        marginTop: 8,
        fontSize: '0.75rem',
      }}
    >
      {rules.map(rule => (
        <span
          key={rule.key}
          data-testid={`${testIdPrefix}-rule-${rule.key}`}
          style={{
            color: rule.passed ? SUCCESS_GREEN : 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: rule.passed ? 600 : 400,
          }}
        >
          {rule.passed ? '✓' : '•'} {rule.label}
        </span>
      ))}
    </div>
  );
};

export interface AuthModalProps {
  isOpen?: boolean;
  onClose: () => void;
  authTab: 'login' | 'register';
  setAuthTab: (tab: 'login' | 'register') => void;
  authError: string | null;
  authLoading: boolean;
  loginEmail: string;
  setLoginEmail: (val: string) => void;
  loginPassword: string;
  setLoginPassword: (val: string) => void;
  registerName: string;
  setRegisterName: (val: string) => void;
  registerEmail: string;
  setRegisterEmail: (val: string) => void;
  registerPassword: string;
  setRegisterPassword: (val: string) => void;
  registerConfirmPassword?: string;
  setRegisterConfirmPassword?: (val: string) => void;
  registerPhone: string;
  setRegisterPhone: (val: string) => void;
  onLogin: (e: React.FormEvent, values?: { email: string; password: string }) => void;
  onRegister: (e: React.FormEvent, values?: RegisterFormValues) => void;
  /** Xóa mọi lỗi phía App (banner + lỗi từng ô) — gọi khi chuyển tab. */
  onClearAuthErrors?: () => void;
  isModal?: boolean;
  loginEmailError?: string | null;
  loginPasswordError?: string | null;
  /** Lỗi theo từng ô do BE trả về khi đăng ký (email/SĐT trùng...) — App truyền xuống. */
  registerFieldErrors?: RegisterFieldErrors;
  /** Đăng ký vừa thành công → hiện `register-success-msg` ở tab Đăng nhập (CN-01.4). */
  registerSuccess?: boolean;
  /** Phiên JWT hết hạn (401) → hiện `session-expired-notice` (CN-02 E3). */
  sessionExpired?: boolean;
  /** Đăng nhập social thật: nhận token của nhà cung cấp, trả về thông điệp lỗi hoặc null khi thành công. */
  onSocialLogin?: (provider: SocialProviderKey, token: string) => Promise<string | null>;
  /** Đăng nhập social giả lập (môi trường test): trả về thông điệp lỗi hoặc null khi thành công. */
  onSocialMockLogin?: (provider: SocialProviderKey) => Promise<string | null>;
  /** Gốc API để lấy /api/auth/social/config; mặc định lấy từ biến môi trường như App. */
  socialApiBase?: string;
}

const GoogleLogo: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

const FacebookLogo: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
  </svg>
);

interface LoginFieldErrors {
  email: string | null;
  password: string | null;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen = true,
  onClose,
  authTab,
  setAuthTab,
  authError,
  authLoading,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  registerName,
  setRegisterName,
  registerEmail,
  setRegisterEmail,
  registerPassword,
  setRegisterPassword,
  registerConfirmPassword = '',
  setRegisterConfirmPassword,
  registerPhone,
  setRegisterPhone,
  onLogin,
  onRegister,
  onClearAuthErrors,
  isModal = false,
  loginEmailError,
  loginPasswordError,
  registerFieldErrors,
  registerSuccess = false,
  sessionExpired = false,
  onSocialLogin,
  onSocialMockLogin,
  socialApiBase,
}) => {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

  // Lỗi validate phía client của form đăng nhập (ưu tiên hiển thị hơn lỗi từ props).
  const [loginErrors, setLoginErrors] = useState<LoginFieldErrors>({ email: null, password: null });
  const [loginEmailTouched, setLoginEmailTouched] = useState(false);

  // Lỗi validate phía client của form đăng ký, theo từng ô.
  const [registerErrors, setRegisterErrors] = useState<RegisterFieldErrors>({});

  // Đăng nhập mạng xã hội: cấu hình công khai từ BE + panel mock.
  const [socialConfig, setSocialConfig] = useState<SocialConfig | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [socialBusyProvider, setSocialBusyProvider] = useState<SocialProviderKey | null>(null);
  const [mockProvider, setMockProvider] = useState<SocialProviderKey | null>(null);
  const resolvedSocialApiBase = socialApiBase ?? SOCIAL_API_BASE;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchSocialConfig(resolvedSocialApiBase).then(config => {
      if (!cancelled) setSocialConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, resolvedSocialApiBase]);

  useEffect(() => {
    if (!isOpen) {
      setSocialError(null);
      setMockProvider(null);
    }
  }, [isOpen]);

  // Chuyển tab (kể cả khi đổi route /login <-> /register) là xóa sạch lỗi cũ.
  useEffect(() => {
    setLoginErrors({ email: null, password: null });
    setLoginEmailTouched(false);
    setRegisterErrors({});
  }, [authTab]);

  const switchTab = (tab: 'login' | 'register') => {
    setLoginErrors({ email: null, password: null });
    setLoginEmailTouched(false);
    setRegisterErrors({});
    setSocialError(null);
    setMockProvider(null);
    if (onClearAuthErrors) onClearAuthErrors();
    setAuthTab(tab);
  };

  // ----------------------------------------
  // Đăng nhập mạng xã hội (Google / Facebook)
  // ----------------------------------------
  const effectiveSocialConfig = socialConfig ?? FALLBACK_SOCIAL_CONFIG;

  const handleSocialClick = async (provider: SocialProviderKey) => {
    const config = effectiveSocialConfig;
    const label = SOCIAL_PROVIDER_LABEL[provider];
    setSocialError(null);
    if (isSocialMockMode(config, provider)) {
      // Môi trường test/dev chưa cấu hình provider thật: mở panel giả lập.
      setMockProvider(provider);
      return;
    }
    if (!isSocialRealMode(config, provider)) return;
    if (!onSocialLogin) {
      setSocialError('Chức năng đăng nhập mạng xã hội chưa được kết nối.');
      return;
    }
    setSocialBusyProvider(provider);
    try {
      const result =
        provider === 'google'
          ? await signInWithGoogleSdk(config.googleClientId as string)
          : await signInWithFacebookSdk(config.facebookAppId as string);
      if (result.type === 'token') {
        const error = await onSocialLogin(provider, result.token);
        if (error) setSocialError(error);
      } else if (result.type === 'cancelled') {
        setSocialError(`Bạn đã hủy đăng nhập bằng ${label}. Vui lòng thử lại hoặc dùng email và mật khẩu.`);
      } else {
        setSocialError(`Không kết nối được với ${label}. Vui lòng kiểm tra mạng và thử lại.`);
      }
    } catch {
      setSocialError(`Không kết nối được với ${label}. Vui lòng kiểm tra mạng và thử lại.`);
    } finally {
      setSocialBusyProvider(null);
    }
  };

  const handleSocialMockConfirm = async () => {
    if (!mockProvider) return;
    const provider = mockProvider;
    if (!onSocialMockLogin) {
      setSocialError('Chức năng đăng nhập mạng xã hội chưa được kết nối.');
      return;
    }
    setSocialBusyProvider(provider);
    setSocialError(null);
    try {
      const error = await onSocialMockLogin(provider);
      if (error) {
        setSocialError(error);
      } else {
        setMockProvider(null);
      }
    } finally {
      setSocialBusyProvider(null);
    }
  };

  const handleSocialMockCancel = () => {
    if (!mockProvider) return;
    const label = SOCIAL_PROVIDER_LABEL[mockProvider];
    setMockProvider(null);
    setSocialError(`Bạn đã hủy đăng nhập bằng ${label}. Vui lòng thử lại hoặc dùng email và mật khẩu.`);
  };

  // ----------------------------------------
  // Đăng nhập: validate client trước khi gọi onLogin
  // ----------------------------------------
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const errors: LoginFieldErrors = { email: null, password: null };
    if (!email) {
      errors.email = 'Email không được để trống.';
    } else if (!isValidEmail(email)) {
      errors.email = 'Email không đúng định dạng.';
    }
    if (!loginPassword) {
      errors.password = 'Mật khẩu không được để trống.';
    }
    setLoginErrors(errors);
    if (errors.email || errors.password) return;
    onLogin(e, { email, password: loginPassword });
  };

  const handleLoginEmailChange = (value: string) => {
    setLoginEmail(value);
    if (loginErrors.email) setLoginErrors(prev => ({ ...prev, email: null }));
  };

  const handleLoginPasswordChange = (value: string) => {
    setLoginPassword(value);
    if (loginErrors.password) setLoginErrors(prev => ({ ...prev, password: null }));
  };

  // ----------------------------------------
  // Đăng ký: validate client theo CN-01 trước khi gọi onRegister
  // ----------------------------------------
  const clearRegisterError = (field: RegisterFieldKey) => {
    setRegisterErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validateConfirmPassword = (confirmValue: string): string | undefined => {
    if (confirmValue && confirmValue !== registerPassword) {
      return 'Mật khẩu xác nhận không khớp';
    }
    return undefined;
  };

  const shownRegisterError = (field: RegisterFieldKey): string | undefined =>
    registerErrors[field] ?? registerFieldErrors?.[field];

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const values: RegisterFormValues = {
      fullName: registerName.trim(),
      email: registerEmail.trim().toLowerCase(),
      password: registerPassword,
      phoneNumber: registerPhone.trim(),
    };
    // Đồng bộ lại các ô text đã trim để người dùng thấy đúng giá trị sẽ gửi.
    if (values.fullName !== registerName) setRegisterName(values.fullName);
    if (values.email !== registerEmail) setRegisterEmail(values.email);
    if (values.phoneNumber !== registerPhone) setRegisterPhone(values.phoneNumber);

    const errors: RegisterFieldErrors = {};
    // CN-01.2: họ tên hợp lệ khi 2–50 ký tự — một thông điệp duy nhất.
    if (values.fullName.length < 2 || values.fullName.length > 50) {
      errors.name = 'Họ tên không hợp lệ';
    }
    if (!values.email) {
      errors.email = 'Vui lòng nhập email.';
    } else if (!isValidEmail(values.email)) {
      errors.email = 'Email không đúng định dạng.';
    }
    if (!values.password) {
      errors.password = 'Vui lòng nhập mật khẩu.';
    } else if (
      values.password.length < 8 ||
      !/[A-Z]/.test(values.password) ||
      !/\d/.test(values.password) ||
      !/[^a-zA-Z0-9]/.test(values.password)
    ) {
      errors.password = 'Mật khẩu chưa đáp ứng đủ các điều kiện bảo mật bên dưới.';
    }
    if (!registerConfirmPassword) {
      errors.confirmPassword = 'Vui lòng nhập lại mật khẩu.';
    } else {
      const confirmError = validateConfirmPassword(registerConfirmPassword);
      if (confirmError) errors.confirmPassword = confirmError;
    }
    // CN-01.2: SĐT bắt buộc, 10 chữ số bắt đầu bằng 0.
    if (!isValidVietnamesePhone(values.phoneNumber)) {
      errors.phone = 'Số điện thoại không hợp lệ';
    }

    setRegisterErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    onRegister(e, values);
  };

  const authTitle = authTab === 'login' ? 'Đăng nhập tài khoản' : 'Đăng ký thành viên mới';

  const shownLoginEmailError =
    loginErrors.email ??
    loginEmailError ??
    (loginEmailTouched && loginEmail.trim() && !isValidEmail(loginEmail)
      ? 'Email không đúng định dạng.'
      : null);
  const shownLoginPasswordError = loginErrors.password ?? loginPasswordError;
  // Lỗi thông tin đăng nhập chỉ hiện MỘT chỗ: dưới ô mật khẩu. Nếu banner trùng
  // nội dung với lỗi dưới ô thì ẩn banner để không bao giờ hiện hai nơi.
  const shownBannerError =
    authError && shownLoginPasswordError && authError === shownLoginPasswordError ? null : authError;
  const busy = authLoading;

  if (isOpen === false) return null;

  const content = (
    <div className={`auth-card ${isModal ? 'modal-content' : 'auth-page-card'}`} onClick={e => e.stopPropagation()} data-testid="auth-modal">
      {!isModal && (
        <aside className="auth-side-panel" aria-hidden="true">
          <div className="auth-side-logo">D</div>
          <div className="auth-side-name">DAFL</div>
        </aside>
      )}
      <div className={isModal ? undefined : 'auth-main-panel'}>
        <div className={isModal ? 'modal-header' : 'auth-card-header'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isModal && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={onClose}
                data-testid="auth-close-btn"
                title="Quay lại trang chủ"
              >
                <ArrowLeft size={16} /> Trang chủ
              </button>
            )}
            <h2 className="modal-title" style={{ margin: 0 }} data-testid="auth-modal-title">
              {authTitle}
            </h2>
          </div>
          {isModal && (
            <button className="close-btn" onClick={onClose} data-testid="auth-close-btn" title="Đóng">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            type="button"
            className={`tab-btn ${authTab === 'login' ? 'active' : ''}`}
            onClick={() => switchTab('login')}
            data-testid="auth-tab-login"
          >
            Đăng nhập
          </button>
          <button
            type="button"
            className={`tab-btn ${authTab === 'register' ? 'active' : ''}`}
            onClick={() => switchTab('register')}
            data-testid="auth-tab-register"
          >
            Đăng ký
          </button>
        </div>

        {sessionExpired && authTab === 'login' && (
          <div
            data-testid="session-expired-notice"
            style={{
              background: '#fff8e1',
              border: '1px solid #f59e0b',
              color: 'var(--text-main)',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.85rem',
              lineHeight: 1.5,
            }}
          >
            Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
          </div>
        )}

        {registerSuccess && authTab === 'login' && (
          <div
            data-testid="register-success-msg"
            style={{
              background: 'rgba(22, 163, 74, 0.1)',
              border: '1px solid #16a34a',
              color: 'var(--text-main)',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.85rem',
              lineHeight: 1.5,
            }}
          >
            Đăng ký thành công. Vui lòng đăng nhập để tiếp tục mua sắm.
          </div>
        )}

        {shownBannerError && (
          <div
            data-testid="auth-error-msg"
            style={{
              background: 'rgba(228, 0, 70, 0.08)',
              border: '1px solid #e40046',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.85rem'
            }}
          >
            {shownBannerError}
          </div>
        )}

        {authTab === 'login' ? (
          <form onSubmit={handleLoginSubmit} noValidate data-testid="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email đăng nhập</label>
              <input
                id="login-email"
                className="form-input"
                type="email"
                data-testid="login-email-input"
                value={loginEmail}
                onChange={e => handleLoginEmailChange(e.target.value)}
                onBlur={() => setLoginEmailTouched(true)}
                style={errorBorderStyle(!!shownLoginEmailError)}
              />
              {shownLoginEmailError && (
                <div data-testid="login-email-error" style={fieldErrorStyle}>
                  {shownLoginEmailError}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Mật khẩu</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  className="form-input"
                  type={showLoginPassword ? 'text' : 'password'}
                  data-testid="login-password-input"
                  value={loginPassword}
                  onChange={e => handleLoginPasswordChange(e.target.value)}
                  style={{ paddingRight: 40, ...errorBorderStyle(!!shownLoginPasswordError) }}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showLoginPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-label={showLoginPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  data-testid="toggle-login-password-btn"
                >
                  {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {shownLoginPasswordError && (
                <div data-testid="login-password-error" style={fieldErrorStyle}>
                  {shownLoginPasswordError}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: 10 }}
              disabled={busy}
              data-testid="login-submit-btn"
            >
              {authLoading ? 'Đang xử lý...' : 'Đăng nhập'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} noValidate data-testid="register-form">
            <div className="form-group">
              <label className="form-label" htmlFor="register-name">Họ và tên</label>
              <input
                id="register-name"
                className="form-input"
                data-testid="register-name-input"
                value={registerName}
                onChange={e => {
                  setRegisterName(e.target.value);
                  clearRegisterError('name');
                }}
                placeholder="Nguyễn Văn A"
                style={errorBorderStyle(!!shownRegisterError('name'))}
              />
              {shownRegisterError('name') && (
                <div data-testid="register-name-error" style={fieldErrorStyle}>
                  {shownRegisterError('name')}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="register-email">Email</label>
              <input
                id="register-email"
                className="form-input"
                type="email"
                data-testid="register-email-input"
                value={registerEmail}
                onChange={e => {
                  setRegisterEmail(e.target.value);
                  clearRegisterError('email');
                }}
                placeholder="name@example.com"
                style={errorBorderStyle(!!shownRegisterError('email'))}
              />
              {shownRegisterError('email') && (
                <div data-testid="register-email-error" style={fieldErrorStyle}>
                  {shownRegisterError('email')}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="register-password">Mật khẩu</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="register-password"
                  className="form-input"
                  type={showRegisterPassword ? 'text' : 'password'}
                  data-testid="register-password-input"
                  value={registerPassword}
                  onChange={e => {
                    setRegisterPassword(e.target.value);
                    clearRegisterError('password');
                  }}
                  placeholder="Tối thiểu 8 ký tự, gồm chữ hoa & ký tự đặc biệt"
                  style={{ paddingRight: 40, ...errorBorderStyle(!!shownRegisterError('password')) }}
                />
                <button
                  type="button"
                  onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showRegisterPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-label={showRegisterPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  data-testid="toggle-register-password-btn"
                >
                  {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <PasswordRuleList password={registerPassword} testIdPrefix="password" />
              {shownRegisterError('password') && (
                <div data-testid="register-password-error" style={fieldErrorStyle}>
                  {shownRegisterError('password')}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="register-confirm-password">Nhập lại mật khẩu</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="register-confirm-password"
                  className="form-input"
                  type={showRegisterConfirmPassword ? 'text' : 'password'}
                  data-testid="register-confirm-password-input"
                  value={registerConfirmPassword}
                  onChange={e => {
                    const nextValue = e.target.value;
                    if (setRegisterConfirmPassword) setRegisterConfirmPassword(nextValue);
                    if (nextValue && nextValue === registerPassword) clearRegisterError('confirmPassword');
                  }}
                  onBlur={e => {
                    const mismatch = validateConfirmPassword(e.target.value);
                    setRegisterErrors(prev => ({ ...prev, confirmPassword: mismatch }));
                  }}
                  placeholder="Nhập lại mật khẩu để xác nhận"
                  style={{ paddingRight: 40, ...errorBorderStyle(!!shownRegisterError('confirmPassword')) }}
                />
                <button
                  type="button"
                  onClick={() => setShowRegisterConfirmPassword(!showRegisterConfirmPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showRegisterConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-label={showRegisterConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  data-testid="toggle-register-confirm-password-btn"
                >
                  {showRegisterConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {shownRegisterError('confirmPassword') && (
                <div data-testid="register-confirm-password-error" style={fieldErrorStyle}>
                  {shownRegisterError('confirmPassword')}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="register-phone">Số điện thoại</label>
              <input
                id="register-phone"
                className="form-input"
                data-testid="register-phone-input"
                value={registerPhone}
                onChange={e => {
                  setRegisterPhone(e.target.value);
                  clearRegisterError('phone');
                }}
                placeholder="0987654321"
                style={errorBorderStyle(!!shownRegisterError('phone'))}
              />
              {shownRegisterError('phone') && (
                <div data-testid="register-phone-error" style={fieldErrorStyle}>
                  {shownRegisterError('phone')}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: 10 }}
              disabled={authLoading}
              data-testid="register-submit-btn"
            >
              {authLoading ? 'Đang tạo tài khoản...' : 'Đăng ký ngay'}
            </button>
          </form>
        )}

        {/* Khối đăng nhập nhanh bằng mạng xã hội — hiện ở cả hai tab */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>hoặc tiếp tục với</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          </div>

          {socialError && (
            <div data-testid="social-error" style={{ color: ERROR_COLOR, fontSize: '0.85rem', marginBottom: 12 }}>
              {socialError}
            </div>
          )}
          {socialBusyProvider && (
            <div data-testid="social-loading" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 12 }}>
              Đang kết nối với {SOCIAL_PROVIDER_LABEL[socialBusyProvider]}...
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            {(['google', 'facebook'] as SocialProviderKey[]).map(provider => {
              if (!isSocialProviderVisible(effectiveSocialConfig, provider)) return null;
              const label = SOCIAL_PROVIDER_LABEL[provider];
              return (
                <button
                  key={provider}
                  type="button"
                  data-testid={`social-${provider}-btn`}
                  data-mock={isSocialMockMode(effectiveSocialConfig, provider) ? 'true' : undefined}
                  onClick={() => handleSocialClick(provider)}
                  disabled={busy || socialBusyProvider !== null}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '11px 14px',
                    background: '#fff',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  {provider === 'google' ? <GoogleLogo /> : <FacebookLogo />}
                  Tiếp tục với {label}
                </button>
              );
            })}
          </div>

          {mockProvider && (
            <div
              data-testid="social-mock-panel"
              style={{
                marginTop: 14,
                border: '1px dashed #f59e0b',
                background: '#fff8e1',
                borderRadius: 10,
                padding: '14px 16px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 6 }}>
                Môi trường kiểm thử — đăng nhập giả lập
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                Bạn đang đăng nhập bằng {SOCIAL_PROVIDER_LABEL[mockProvider]} với tài khoản mẫu:
              </p>
              <p style={{ fontSize: '0.9rem', margin: '0 0 12px' }}>
                <strong>{SOCIAL_MOCK_USERS[mockProvider].fullName}</strong> — {SOCIAL_MOCK_USERS[mockProvider].email}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '9px 16px' }}
                  onClick={handleSocialMockConfirm}
                  disabled={socialBusyProvider !== null}
                  data-testid="social-mock-confirm-btn"
                >
                  Đồng ý đăng nhập
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '9px 16px' }}
                  onClick={handleSocialMockCancel}
                  disabled={socialBusyProvider !== null}
                  data-testid="social-mock-cancel-btn"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="modal-overlay" onClick={onClose} data-testid="auth-modal-overlay">
        {content}
      </div>
    );
  }

  return (
    <div className="auth-page-wrapper" data-testid="auth-page">
      {content}
    </div>
  );
};
