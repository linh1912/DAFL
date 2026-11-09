import React, { useEffect, useState } from 'react';
import { X, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { apiJson } from '../../utils/api';
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const isValidVietnamesePhone = (phone: string) => /^0\d{9}$/.test(phone.trim());

const ERROR_COLOR = '#d81b60';
const SUCCESS_GREEN = '#16a34a';

const fieldErrorStyle: React.CSSProperties = { color: ERROR_COLOR, fontSize: '0.85rem', marginTop: 6 };
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
        fontSize: '0.8rem',
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

interface ForgotPasswordFlowProps {
  step: 'none' | 'request' | 'reset' | 'done';
  forgotEmail: string;
  setForgotEmail: (val: string) => void;
  forgotEmailError: string | null;
  setForgotEmailError: (val: string | null) => void;
  forgotNotice: string | null;
  forgotError: string | null;
  forgotBusy: boolean;
  resetCode: string;
  setResetCode: (val: string) => void;
  resetCodeError: string | null;
  setResetCodeError: (val: string | null) => void;
  resetNewPassword: string;
  setResetNewPassword: (val: string) => void;
  resetPasswordError: string | null;
  setResetPasswordError: (val: string | null) => void;
  resetConfirmPassword: string;
  setResetConfirmPassword: (val: string) => void;
  resetConfirmError: string | null;
  setResetConfirmError: (val: string | null) => void;
  showResetNewPassword: boolean;
  setShowResetNewPassword: (val: boolean) => void;
  showResetConfirmPassword: boolean;
  setShowResetConfirmPassword: (val: boolean) => void;
  onForgotSubmit: (e: React.FormEvent) => void;
  onResetSubmit: (e: React.FormEvent) => void;
  onBackToLogin: () => void;
}

/**
 * Luồng quên mật khẩu (đợt 13, mục 1) — 3 bước trong AuthModal:
 * request: nhập email xin mã 6 số (gửi qua SMTP) → reset: nhập mã + mật khẩu mới → done.
 * Dùng chung cho cả shop và admin vì cùng endpoint backend /api/auth/forgot-password
 * và /api/auth/reset-password.
 */
const ForgotPasswordFlow: React.FC<ForgotPasswordFlowProps> = ({
  step,
  forgotEmail,
  setForgotEmail,
  forgotEmailError,
  setForgotEmailError,
  forgotNotice,
  forgotError,
  forgotBusy,
  resetCode,
  setResetCode,
  resetCodeError,
  setResetCodeError,
  resetNewPassword,
  setResetNewPassword,
  resetPasswordError,
  setResetPasswordError,
  resetConfirmPassword,
  setResetConfirmPassword,
  resetConfirmError,
  setResetConfirmError,
  showResetNewPassword,
  setShowResetNewPassword,
  showResetConfirmPassword,
  setShowResetConfirmPassword,
  onForgotSubmit,
  onResetSubmit,
  onBackToLogin,
}) => {
  const eyeBtnStyle: React.CSSProperties = {
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
    justifyContent: 'center',
  };
  const backLink = (
    <div style={{ textAlign: 'left', marginTop: 12 }}>
      <button
        type="button"
        onClick={onBackToLogin}
        data-testid="forgot-password-back-btn"
        style={{ background: 'none', border: 'none', color: '#d81b60', fontSize: '0.85rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
      >
        ← Quay lại đăng nhập
      </button>
    </div>
  );

  if (step === 'done') {
    return (
      <div data-testid="forgot-password-success">
        <div
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
          {forgotNotice || 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.'}
        </div>
        {backLink}
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <div>
        {forgotNotice && (
          <div
            data-testid="forgot-password-notice"
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
            {forgotNotice} Mã có hiệu lực trong 15 phút.
          </div>
        )}
        {forgotError && (
          <div
            data-testid="reset-password-error"
            style={{
              background: 'rgba(228, 0, 70, 0.08)',
              border: '1px solid #d81b60',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.85rem',
            }}
          >
            {forgotError}
          </div>
        )}
        <form onSubmit={onResetSubmit} noValidate data-testid="reset-password-form">
          <div className="form-group">
            <label className="form-label" htmlFor="reset-code">Mã đặt lại (6 chữ số, đã gửi tới {forgotEmail})</label>
            <input
              id="reset-code"
              className="form-input"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              data-testid="reset-code-input"
              value={resetCode}
              onChange={e => {
                setResetCode(e.target.value.replace(/\D/g, ''));
                if (resetCodeError) setResetCodeError(null);
              }}
              placeholder="123456"
              style={errorBorderStyle(!!resetCodeError)}
            />
            {resetCodeError && (
              <div data-testid="reset-code-error" style={fieldErrorStyle}>{resetCodeError}</div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="reset-new-password">Mật khẩu mới</label>
            <div style={{ position: 'relative' }}>
              <input
                id="reset-new-password"
                className="form-input"
                type={showResetNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                data-testid="reset-new-password-input"
                value={resetNewPassword}
                onChange={e => {
                  setResetNewPassword(e.target.value);
                  if (resetPasswordError) setResetPasswordError(null);
                }}
                placeholder="Tối thiểu 8 ký tự, gồm chữ hoa & ký tự đặc biệt"
                style={{ paddingRight: 40, ...errorBorderStyle(!!resetPasswordError) }}
              />
              <button
                type="button"
                onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                style={eyeBtnStyle}
                title={showResetNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-label={showResetNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                data-testid="toggle-reset-new-password-btn"
              >
                {showResetNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <PasswordRuleList password={resetNewPassword} testIdPrefix="reset-password" />
            {resetPasswordError && (
              <div data-testid="reset-new-password-error" style={fieldErrorStyle}>{resetPasswordError}</div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="reset-confirm-password">Nhập lại mật khẩu mới</label>
            <div style={{ position: 'relative' }}>
              <input
                id="reset-confirm-password"
                className="form-input"
                type={showResetConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                data-testid="reset-confirm-password-input"
                value={resetConfirmPassword}
                onChange={e => {
                  setResetConfirmPassword(e.target.value);
                  if (resetConfirmError) setResetConfirmError(null);
                }}
                placeholder="Nhập lại mật khẩu mới để xác nhận"
                style={{ paddingRight: 40, ...errorBorderStyle(!!resetConfirmError) }}
              />
              <button
                type="button"
                onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                style={eyeBtnStyle}
                title={showResetConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-label={showResetConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                data-testid="toggle-reset-confirm-password-btn"
              >
                {showResetConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {resetConfirmError && (
              <div data-testid="reset-confirm-password-error" style={fieldErrorStyle}>{resetConfirmError}</div>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: 10 }}
            disabled={forgotBusy}
            data-testid="reset-password-submit-btn"
          >
            {forgotBusy ? 'Đang xử lý...' : 'Đặt lại mật khẩu'}
          </button>
        </form>
        {backLink}
      </div>
    );
  }

  // step === 'request' (mặc định khi mở luồng quên mật khẩu)
  return (
    <div>
      {forgotError && (
        <div
          data-testid="forgot-password-error"
          style={{
            background: 'rgba(228, 0, 70, 0.08)',
            border: '1px solid #d81b60',
            color: '#b91c1c',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: '0.85rem',
          }}
        >
          {forgotError}
        </div>
      )}
      <form onSubmit={onForgotSubmit} noValidate data-testid="forgot-password-form">
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Nhập email tài khoản của bạn, chúng tôi sẽ gửi mã đặt lại mật khẩu (6 chữ số, hiệu lực 15 phút) tới email đó.
        </p>
        <div className="form-group">
          <label className="form-label" htmlFor="forgot-password-email">Email tài khoản</label>
          <input
            id="forgot-password-email"
            className="form-input"
            type="email"
            autoComplete="email"
            data-testid="forgot-password-email-input"
            value={forgotEmail}
            onChange={e => {
              setForgotEmail(e.target.value);
              if (forgotEmailError) setForgotEmailError(null);
            }}
            placeholder="name@example.com"
            style={errorBorderStyle(!!forgotEmailError)}
          />
          {forgotEmailError && (
            <div data-testid="forgot-password-email-error" style={fieldErrorStyle}>{forgotEmailError}</div>
          )}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: 10 }}
          disabled={forgotBusy}
          data-testid="forgot-password-submit-btn"
        >
          {forgotBusy ? 'Đang gửi mã...' : 'Gửi mã đặt lại'}
        </button>
      </form>
      {backLink}
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
  /** Chế độ admin-riêng (localhost:3001): chỉ form đăng nhập cơ bản —
   *  KHÔNG tab/link đăng ký (đăng nhập social đã bỏ hẳn ở mọi nơi).
   *  Link "Quên mật khẩu" VẪN có (đợt 13, mục 1): admin quên mật khẩu cũng
   *  đặt lại bằng mã 6 số gửi qua email như tài khoản shop. */
  adminOnly?: boolean;
}

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
  adminOnly = false,
}) => {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

  // Lỗi validate phía client của form đăng nhập (ưu tiên hiển thị hơn lỗi từ props).
  const [loginErrors, setLoginErrors] = useState<LoginFieldErrors>({ email: null, password: null });
  const [loginEmailTouched, setLoginEmailTouched] = useState(false);

  // Lỗi validate phía client của form đăng ký, theo từng ô.
  const [registerErrors, setRegisterErrors] = useState<RegisterFieldErrors>({});

  // ----------------------------------------
  // Quên mật khẩu (đợt 13, mục 1): 3 bước trong cùng modal —
  // 'request': nhập email xin mã → 'reset': nhập mã 6 số + mật khẩu mới → 'done': thành công.
  // Dùng chung cho cả shop và admin (adminOnly) vì cùng 1 endpoint backend.
  // ----------------------------------------
  type ForgotStep = 'none' | 'request' | 'reset' | 'done';
  const [forgotStep, setForgotStep] = useState<ForgotStep>('none');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotEmailError, setForgotEmailError] = useState<string | null>(null);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetCodeError, setResetCodeError] = useState<string | null>(null);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetConfirmError, setResetConfirmError] = useState<string | null>(null);

  const resetForgotFlow = () => {
    setForgotStep('none');
    setForgotEmail('');
    setForgotEmailError(null);
    setForgotNotice(null);
    setForgotError(null);
    setResetCode('');
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetCodeError(null);
    setResetPasswordError(null);
    setResetConfirmError(null);
  };

  // Chuyển tab (kể cả khi đổi route /login <-> /register) là xóa sạch lỗi cũ.
  useEffect(() => {
    setLoginErrors({ email: null, password: null });
    setLoginEmailTouched(false);
    setRegisterErrors({});
    resetForgotFlow();
  }, [authTab]);

  const switchTab = (tab: 'login' | 'register') => {
    setLoginErrors({ email: null, password: null });
    setLoginEmailTouched(false);
    setRegisterErrors({});
    resetForgotFlow();
    if (onClearAuthErrors) onClearAuthErrors();
    setAuthTab(tab);
  };

  const openForgotFlow = () => {
    setForgotEmail(loginEmail);
    setForgotEmailError(null);
    setForgotError(null);
    setForgotNotice(null);
    setForgotStep('request');
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = forgotEmail.trim().toLowerCase();
    if (!email) {
      setForgotEmailError('Vui lòng nhập email.');
      return;
    }
    if (!isValidEmail(email)) {
      setForgotEmailError('Email không đúng định dạng.');
      return;
    }
    setForgotEmailError(null);
    setForgotError(null);
    setForgotBusy(true);
    try {
      const { body } = await apiJson<string>('/api/auth/forgot-password', {
        method: 'POST',
        skipAuthHandler: true,
        body: JSON.stringify({ email }),
      });
      // BE luôn trả câu chung dù email có tồn tại hay không (chống dò tài khoản).
      setForgotNotice(body?.message || 'Nếu email tồn tại, mã đặt lại đã được gửi.');
      setForgotStep('reset');
    } catch {
      setForgotError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
    } finally {
      setForgotBusy(false);
    }
  };

  const isValidResetPassword = (password: string) =>
    password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password) && /[^a-zA-Z0-9]/.test(password);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let hasError = false;
    if (!/^\d{6}$/.test(resetCode.trim())) {
      setResetCodeError('Mã đặt lại gồm 6 chữ số.');
      hasError = true;
    }
    if (!resetNewPassword) {
      setResetPasswordError('Vui lòng nhập mật khẩu mới.');
      hasError = true;
    } else if (!isValidResetPassword(resetNewPassword)) {
      setResetPasswordError('Mật khẩu chưa đáp ứng đủ các điều kiện bảo mật bên dưới.');
      hasError = true;
    }
    if (!resetConfirmPassword) {
      setResetConfirmError('Vui lòng nhập lại mật khẩu.');
      hasError = true;
    } else if (resetConfirmPassword !== resetNewPassword) {
      setResetConfirmError('Mật khẩu xác nhận không khớp');
      hasError = true;
    }
    if (hasError) return;
    setForgotError(null);
    setForgotBusy(true);
    try {
      const { status, body } = await apiJson<string>('/api/auth/reset-password', {
        method: 'POST',
        skipAuthHandler: true,
        body: JSON.stringify({
          email: forgotEmail.trim().toLowerCase(),
          code: resetCode.trim(),
          newPassword: resetNewPassword,
          confirmNewPassword: resetConfirmPassword,
        }),
      });
      if (status === 200 && body?.success) {
        setForgotNotice(body.message || 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.');
        setForgotStep('done');
      } else {
        setForgotError(body?.message || 'Mã đặt lại không đúng hoặc đã hết hạn.');
      }
    } catch {
      setForgotError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
    } finally {
      setForgotBusy(false);
    }
  };

  // ----------------------------------------
  // Đăng nhập: validate client trước khi gọi onLogin
  // ----------------------------------------
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Chế độ admin-riêng: nhập "admin" cũng đăng nhập được bằng tài khoản admin@dafl.vn.
    const rawEmail = loginEmail.trim().toLowerCase();
    const email = adminOnly && rawEmail === 'admin' ? 'admin@dafl.vn' : rawEmail;
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

  // Chế độ admin-riêng ép về tab đăng nhập dù App có truyền tab khác.
  const effectiveTab = adminOnly ? 'login' : authTab;
  const authTitle =
    forgotStep === 'request' ? 'Quên mật khẩu'
    : forgotStep === 'reset' || forgotStep === 'done' ? 'Đặt lại mật khẩu'
    : adminOnly ? 'Đăng nhập quản trị'
    : authTab === 'login' ? 'Đăng nhập tài khoản' : 'Đăng ký thành viên mới';

  // "admin" là tên đăng nhập hợp lệ ở chế độ admin-riêng (map sang admin@dafl.vn khi submit).
  const loginEmailForCheck = adminOnly && loginEmail.trim().toLowerCase() === 'admin' ? 'admin@dafl.vn' : loginEmail;
  const shownLoginEmailError =
    loginErrors.email ??
    loginEmailError ??
    (loginEmailTouched && loginEmailForCheck.trim() && !isValidEmail(loginEmailForCheck)
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
            {!isModal && !adminOnly && (
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

        {/* Tabs — ẩn hẳn ở chế độ admin-riêng (chỉ có đăng nhập) */}
        {!adminOnly && (
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
        )}

        {sessionExpired && effectiveTab === 'login' && (
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

        {registerSuccess && effectiveTab === 'login' && (
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
              border: '1px solid #d81b60',
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

        {effectiveTab === 'login' && forgotStep === 'none' ? (
          <form onSubmit={handleLoginSubmit} noValidate data-testid="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">{adminOnly ? 'Tên đăng nhập hoặc email' : 'Email đăng nhập'}</label>
              <input
                id="login-email"
                className="form-input"
                type="email"
                autoComplete={adminOnly ? 'off' : 'username'}
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
                  autoComplete={adminOnly ? 'new-password' : 'current-password'}
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

            {/* Quên mật khẩu (đợt 13, mục 1): có ở cả shop lẫn trang đăng nhập admin. */}
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button
                type="button"
                onClick={openForgotFlow}
                data-testid="forgot-password-link"
                style={{ background: 'none', border: 'none', color: '#d81b60', fontSize: '0.85rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                Quên mật khẩu?
              </button>
            </div>
          </form>
        ) : effectiveTab === 'login' ? (
          <ForgotPasswordFlow
            step={forgotStep}
            forgotEmail={forgotEmail}
            setForgotEmail={setForgotEmail}
            forgotEmailError={forgotEmailError}
            setForgotEmailError={setForgotEmailError}
            forgotNotice={forgotNotice}
            forgotError={forgotError}
            forgotBusy={forgotBusy}
            resetCode={resetCode}
            setResetCode={setResetCode}
            resetCodeError={resetCodeError}
            setResetCodeError={setResetCodeError}
            resetNewPassword={resetNewPassword}
            setResetNewPassword={setResetNewPassword}
            resetPasswordError={resetPasswordError}
            setResetPasswordError={setResetPasswordError}
            resetConfirmPassword={resetConfirmPassword}
            setResetConfirmPassword={setResetConfirmPassword}
            resetConfirmError={resetConfirmError}
            setResetConfirmError={setResetConfirmError}
            showResetNewPassword={showResetNewPassword}
            setShowResetNewPassword={setShowResetNewPassword}
            showResetConfirmPassword={showResetConfirmPassword}
            setShowResetConfirmPassword={setShowResetConfirmPassword}
            onForgotSubmit={handleForgotSubmit}
            onResetSubmit={handleResetSubmit}
            onBackToLogin={resetForgotFlow}
          />
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
