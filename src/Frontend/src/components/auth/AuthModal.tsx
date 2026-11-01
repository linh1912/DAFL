import React, { useEffect, useRef, useState } from 'react';
import { X, ArrowLeft, Eye, EyeOff } from 'lucide-react';

export type AuthActionResult = Promise<string | null>;

const formatCountdown = (totalSeconds: number) => {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

interface PasswordRuleListProps {
  password: string;
  testIdPrefix: string;
}

const PasswordRuleList: React.FC<PasswordRuleListProps> = ({ password, testIdPrefix }) => {
  const rules = [
    { key: 'len', label: 'Tối thiểu 8 ký tự', passed: password.length >= 8 },
    { key: 'upper', label: 'Ít nhất 1 chữ hoa (A-Z)', passed: /[A-Z]/.test(password) },
    { key: 'digit', label: 'Ít nhất 1 chữ số (0-9)', passed: /\d/.test(password) },
    { key: 'special', label: 'Ít nhất 1 ký tự đặc biệt (!@#$...)', passed: /[^a-zA-Z0-9]/.test(password) },
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6, fontSize: '0.75rem' }}>
      {rules.map(rule => (
        <span
          key={rule.key}
          data-testid={`${testIdPrefix}-rule-${rule.key}`}
          style={{
            color: rule.passed ? '#10b981' : 'var(--text-muted)',
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

interface OtpCodeInputsProps {
  value: string[];
  onChange: (next: string[]) => void;
  testId: string;
  disabled?: boolean;
}

const OtpCodeInputs: React.FC<OtpCodeInputsProps> = ({ value, onChange, testId, disabled = false }) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const updateFrom = (index: number, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '');
    const next = [...value];
    if (!digits) {
      next[index] = '';
      onChange(next);
      return;
    }
    digits.split('').forEach((digit, offset) => {
      if (index + offset < next.length) next[index + offset] = digit;
    });
    onChange(next);
    const target = Math.min(next.length - 1, index + digits.length);
    window.setTimeout(() => inputRefs.current[target]?.focus(), 0);
  };

  return (
    <div data-testid={testId} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
      {value.map((digit, index) => (
        <input
          key={index}
          ref={element => {
            inputRefs.current[index] = element;
          }}
          className="form-input"
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Ký tự mã xác nhận ${index + 1}`}
          onChange={e => updateFrom(index, e.target.value)}
          onPaste={e => {
            e.preventDefault();
            updateFrom(index, e.clipboardData.getData('text'));
          }}
          onKeyDown={e => {
            if (e.key === 'Backspace' && !digit && index > 0) {
              inputRefs.current[index - 1]?.focus();
            }
            if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
            if (e.key === 'ArrowRight' && index < value.length - 1) inputRefs.current[index + 1]?.focus();
          }}
          style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '10px 0' }}
        />
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
  registerAddress: string;
  setRegisterAddress: (val: string) => void;
  onLogin: (e: React.FormEvent) => void;
  onRegister: (e: React.FormEvent) => void;
  onFillDemoAccount?: () => void;
  isModal?: boolean;
  gateNotice?: boolean;
  loginEmailError?: string | null;
  loginPasswordError?: string | null;
  loginFailureCount?: number;
  verificationEmail?: string | null;
  verificationNotice?: string | null;
  onVerifyEmail?: (code: string) => AuthActionResult;
  onResendVerification?: () => AuthActionResult;
  onOtpLoginRequest?: (email: string) => AuthActionResult;
  onOtpLoginVerify?: (email: string, code: string) => AuthActionResult;
  onForgotPasswordRequest?: (email: string) => AuthActionResult;
  onResetPassword?: (email: string, code: string, newPassword: string) => AuthActionResult;
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
  registerAddress,
  setRegisterAddress,
  onLogin,
  onRegister,
  onFillDemoAccount,
  isModal = false,
  gateNotice = false,
  loginEmailError,
  loginPasswordError,
  loginFailureCount = 0,
  verificationEmail,
  verificationNotice,
  onVerifyEmail,
  onResendVerification,
  onOtpLoginRequest,
  onOtpLoginVerify,
  onForgotPasswordRequest,
  onResetPassword,
}) => {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [authView, setAuthView] = useState<'credentials' | 'otp-login' | 'forgot-request' | 'forgot-reset' | 'forgot-success'>('credentials');
  const [flowLoading, setFlowLoading] = useState(false);

  const [verifyDigits, setVerifyDigits] = useState<string[]>(() => Array(6).fill(''));
  const [verifySecondsLeft, setVerifySecondsLeft] = useState(600);
  const [verifyResendSeconds, setVerifyResendSeconds] = useState(60);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  const [otpLoginEmail, setOtpLoginEmail] = useState('');
  const [otpLoginDigits, setOtpLoginDigits] = useState<string[]>(() => Array(6).fill(''));
  const [otpLoginStep, setOtpLoginStep] = useState<'email' | 'code'>('email');
  const [otpLoginError, setOtpLoginError] = useState<string | null>(null);
  const [otpLoginNotice, setOtpLoginNotice] = useState<string | null>(null);

  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);
  const [forgotResendSeconds, setForgotResendSeconds] = useState(0);
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAuthView('credentials');
      setOtpLoginStep('email');
      setOtpLoginError(null);
      setForgotError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!verificationEmail) return;
    setVerifyDigits(Array(6).fill(''));
    setVerifySecondsLeft(600);
    setVerifyResendSeconds(60);
    setVerifyError(null);
    setVerifyNotice(null);
  }, [verificationEmail]);

  useEffect(() => {
    if (!verificationEmail) return;
    const timer = window.setInterval(() => {
      setVerifySecondsLeft(prev => Math.max(0, prev - 1));
      setVerifyResendSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verificationEmail]);

  useEffect(() => {
    if (forgotResendSeconds <= 0) return;
    const timer = window.setTimeout(() => setForgotResendSeconds(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [forgotResendSeconds]);

  const startOtpLogin = () => {
    setOtpLoginEmail(loginEmail);
    setOtpLoginDigits(Array(6).fill(''));
    setOtpLoginStep('email');
    setOtpLoginError(null);
    setOtpLoginNotice(null);
    setAuthView('otp-login');
  };

  const startForgotPassword = () => {
    setForgotEmail(loginEmail);
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotError(null);
    setForgotNotice(null);
    setForgotResendSeconds(0);
    setAuthView('forgot-request');
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = verifyDigits.join('');
    if (code.length !== 6) {
      setVerifyError('Vui lòng nhập đủ 6 chữ số.');
      return;
    }
    if (verifySecondsLeft <= 0) {
      setVerifyError('Mã xác nhận đã hết hạn. Vui lòng gửi lại mã mới.');
      return;
    }
    if (!onVerifyEmail) {
      setVerifyError('Chức năng xác thực email chưa được kết nối.');
      return;
    }
    setFlowLoading(true);
    setVerifyError(null);
    try {
      const error = await onVerifyEmail(code);
      if (error) setVerifyError(error);
    } finally {
      setFlowLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (verifyResendSeconds > 0) return;
    if (!onResendVerification) {
      setVerifyError('Chức năng gửi lại mã chưa được kết nối.');
      return;
    }
    setFlowLoading(true);
    setVerifyError(null);
    try {
      const error = await onResendVerification();
      if (error) {
        setVerifyError(error);
      } else {
        setVerifyDigits(Array(6).fill(''));
        setVerifySecondsLeft(600);
        setVerifyResendSeconds(60);
        setVerifyNotice('Đã gửi lại mã xác thực về email của bạn.');
      }
    } finally {
      setFlowLoading(false);
    }
  };

  const handleOtpLoginRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = otpLoginEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setOtpLoginError('Email không đúng định dạng.');
      return;
    }
    if (!onOtpLoginRequest) {
      setOtpLoginError('Chức năng đăng nhập bằng OTP chưa được kết nối.');
      return;
    }
    setFlowLoading(true);
    setOtpLoginError(null);
    try {
      const error = await onOtpLoginRequest(email);
      if (error) {
        setOtpLoginError(error);
      } else {
        setOtpLoginEmail(email);
        setOtpLoginDigits(Array(6).fill(''));
        setOtpLoginStep('code');
        setOtpLoginNotice('Nếu thông tin hợp lệ, mã đã được gửi.');
      }
    } finally {
      setFlowLoading(false);
    }
  };

  const handleOtpLoginVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otpLoginDigits.join('');
    if (code.length !== 6) {
      setOtpLoginError('Vui lòng nhập đủ 6 chữ số.');
      return;
    }
    if (!onOtpLoginVerify) {
      setOtpLoginError('Chức năng đăng nhập bằng OTP chưa được kết nối.');
      return;
    }
    setFlowLoading(true);
    setOtpLoginError(null);
    try {
      const error = await onOtpLoginVerify(otpLoginEmail.trim().toLowerCase(), code);
      if (error) setOtpLoginError(error);
    } finally {
      setFlowLoading(false);
    }
  };

  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = forgotEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setForgotError('Email không đúng định dạng.');
      return;
    }
    setFlowLoading(true);
    setForgotError(null);
    try {
      const error = onForgotPasswordRequest ? await onForgotPasswordRequest(email) : null;
      if (error) {
        setForgotError(error);
      } else {
        setForgotEmail(email);
        setForgotNotice('Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.');
        setForgotResendSeconds(60);
        setAuthView('forgot-reset');
      }
    } finally {
      setFlowLoading(false);
    }
  };

  const handleForgotResend = async () => {
    if (forgotResendSeconds > 0) return;
    setFlowLoading(true);
    setForgotError(null);
    try {
      const error = onForgotPasswordRequest ? await onForgotPasswordRequest(forgotEmail) : null;
      if (error) {
        setForgotError(error);
      } else {
        setForgotCode('');
        setForgotNotice('Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.');
        setForgotResendSeconds(60);
      }
    } finally {
      setFlowLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(forgotCode.trim())) {
      setForgotError('Mã xác nhận phải gồm 6 chữ số.');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setForgotError('Mật khẩu phải có tối thiểu 8 ký tự.');
      return;
    }
    if (!/[A-Z]/.test(forgotNewPassword)) {
      setForgotError('Mật khẩu phải chứa ít nhất 1 ký tự chữ hoa (A-Z).');
      return;
    }
    if (!/\d/.test(forgotNewPassword)) {
      setForgotError('Mật khẩu phải chứa ít nhất 1 chữ số (0-9).');
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(forgotNewPassword)) {
      setForgotError('Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt (!@#$%^&*...).');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại.');
      return;
    }

    setFlowLoading(true);
    setForgotError(null);
    try {
      const error = onResetPassword
        ? await onResetPassword(forgotEmail, forgotCode.trim(), forgotNewPassword)
        : null;
      if (error) {
        setForgotError(error);
      } else {
        setForgotCode('');
        setForgotNewPassword('');
        setForgotConfirmPassword('');
        setAuthView('forgot-success');
      }
    } finally {
      setFlowLoading(false);
    }
  };

  const authTitle = verificationEmail
    ? 'Xác thực email'
    : authView === 'otp-login'
      ? 'Đăng nhập bằng mã OTP'
      : authView === 'forgot-success'
        ? 'Đặt lại mật khẩu thành công'
        : authView === 'forgot-request' || authView === 'forgot-reset'
          ? 'Quên mật khẩu'
          : authTab === 'login'
            ? 'Đăng nhập tài khoản'
            : 'Đăng ký thành viên mới';

  const derivedLoginEmailError = loginEmailError || (
    loginEmail && !isValidEmail(loginEmail) ? 'Email không đúng định dạng.' : null
  );
  const busy = authLoading || flowLoading;

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

      {gateNotice && (
        <div
          data-testid="auth-required-notice"
          style={{
            background: 'rgba(245, 158, 11, 0.14)',
            border: '1px solid #f59e0b',
            color: 'var(--text-main)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}
        >
          Bạn chưa đăng nhập. Vui lòng đăng nhập để thêm sản phẩm vào giỏ hàng — hoặc đăng ký nếu chưa có tài khoản.
        </div>
      )}

      {/* Tabs */}
      {!verificationEmail && authView === 'credentials' && (
        <div className="modal-tabs">
          <button
            type="button"
            className={`tab-btn ${authTab === 'login' ? 'active' : ''}`}
            onClick={() => setAuthTab('login')}
            data-testid="auth-tab-login"
          >
            Đăng nhập
          </button>
          <button
            type="button"
            className={`tab-btn ${authTab === 'register' ? 'active' : ''}`}
            onClick={() => setAuthTab('register')}
            data-testid="auth-tab-register"
          >
            Đăng ký
          </button>
        </div>
      )}

        {authError && (
          <div
            data-testid="auth-error-msg"
            style={{
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid #f43f5e',
              color: '#fca5a5',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.85rem'
            }}
          >
            {authError}
          </div>
        )}

        {verificationEmail ? (
          <form onSubmit={handleVerifyEmail} data-testid="register-verify-form">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 16 }}>
              Mã xác thực đã được gửi đến <strong style={{ color: 'var(--text-main)' }}>{verificationEmail}</strong>.
              Mã hết hạn sau <strong style={{ color: 'var(--text-main)' }} data-testid="register-verify-countdown">{formatCountdown(verifySecondsLeft)}</strong>.
            </p>
            {verificationNotice && (
              <div style={{ background: 'rgba(59, 130, 246, 0.12)', border: '1px solid #3b82f6', color: 'var(--text-main)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem', lineHeight: 1.5 }}>
                {verificationNotice}
              </div>
            )}
            {verifyNotice && (
              <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid #10b981', color: 'var(--text-main)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem' }}>
                {verifyNotice}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Mã xác thực</label>
              <OtpCodeInputs value={verifyDigits} onChange={setVerifyDigits} testId="register-verify-otp-input" disabled={busy} />
            </div>
            {(verifyError || verifySecondsLeft <= 0) && (
              <div data-testid="register-verify-error" style={{ color: '#f43f5e', fontSize: '0.85rem', marginBottom: 12 }}>
                {verifyError || 'Mã xác nhận đã hết hạn. Vui lòng gửi lại mã mới.'}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: 4 }}
              disabled={busy || verifySecondsLeft <= 0}
              data-testid="register-verify-btn"
            >
              {flowLoading ? 'Đang xác thực...' : 'Xác thực email'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', padding: '10px', marginTop: 10 }}
              disabled={busy || verifyResendSeconds > 0}
              onClick={handleResendVerification}
              data-testid="register-verify-resend"
            >
              {verifyResendSeconds > 0 ? `Gửi lại mã (${verifyResendSeconds}s)` : 'Gửi lại mã'}
            </button>
          </form>
        ) : authView === 'otp-login' ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem', marginBottom: 16 }}
              onClick={() => setAuthView('credentials')}
            >
              <ArrowLeft size={15} /> Đăng nhập bằng mật khẩu
            </button>
            {otpLoginStep === 'email' ? (
              <form onSubmit={handleOtpLoginRequest} data-testid="otp-login-request-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="otp-login-email">Email</label>
                  <input
                    id="otp-login-email"
                    className="form-input"
                    type="email"
                    data-testid="otp-login-email-input"
                    value={otpLoginEmail}
                    onChange={e => setOtpLoginEmail(e.target.value)}
                    required
                  />
                </div>
                {otpLoginError && (
                  <div data-testid="otp-login-error" style={{ color: '#f43f5e', fontSize: '0.85rem', marginBottom: 12 }}>
                    {otpLoginError}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                  disabled={busy}
                  data-testid="otp-login-send-btn"
                >
                  {flowLoading ? 'Đang gửi mã...' : 'Gửi mã OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleOtpLoginVerify} data-testid="otp-login-verify-form">
                {otpLoginNotice && (
                  <div style={{ background: 'rgba(59, 130, 246, 0.12)', border: '1px solid #3b82f6', color: 'var(--text-main)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem' }}>
                    {otpLoginNotice}
                  </div>
                )}
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 14 }}>
                  Nhập mã 6 số đã gửi đến <strong style={{ color: 'var(--text-main)' }}>{otpLoginEmail}</strong>.
                </p>
                <div className="form-group">
                  <label className="form-label">Mã OTP</label>
                  <OtpCodeInputs value={otpLoginDigits} onChange={setOtpLoginDigits} testId="otp-login-code-input" disabled={busy} />
                </div>
                {otpLoginError && (
                  <div data-testid="otp-login-error" style={{ color: '#f43f5e', fontSize: '0.85rem', marginBottom: 12 }}>
                    {otpLoginError}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                  disabled={busy}
                  data-testid="otp-login-verify-btn"
                >
                  {flowLoading ? 'Đang xác thực...' : 'Đăng nhập bằng OTP'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', padding: '10px', marginTop: 10 }}
                  onClick={() => setOtpLoginStep('email')}
                  disabled={busy}
                >
                  Đổi email
                </button>
              </form>
            )}
          </>
        ) : authView === 'forgot-request' ? (
          <form onSubmit={handleForgotPasswordRequest} data-testid="forgot-password-form">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 16 }}>
              Nhập email của tài khoản để nhận mã đặt lại mật khẩu.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                className="form-input"
                type="email"
                data-testid="forgot-email-input"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                required
              />
            </div>
            {forgotError && (
              <div style={{ color: '#f43f5e', fontSize: '0.85rem', marginBottom: 12 }}>{forgotError}</div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
              disabled={busy}
              data-testid="forgot-submit-btn"
            >
              {flowLoading ? 'Đang gửi mã...' : 'Gửi mã xác nhận'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', padding: '10px', marginTop: 10 }}
              onClick={() => setAuthView('credentials')}
              disabled={busy}
            >
              Quay lại đăng nhập
            </button>
          </form>
        ) : authView === 'forgot-reset' ? (
          <form onSubmit={handleResetPassword} data-testid="forgot-reset-form">
            {forgotNotice && (
              <div style={{ background: 'rgba(59, 130, 246, 0.12)', border: '1px solid #3b82f6', color: 'var(--text-main)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem', lineHeight: 1.5 }}>
                {forgotNotice}
              </div>
            )}
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-otp">Mã xác nhận</label>
              <input
                id="forgot-otp"
                className="form-input"
                data-testid="forgot-otp-input"
                value={forgotCode}
                onChange={e => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.8rem', marginBottom: 16 }}
              disabled={busy || forgotResendSeconds > 0}
              onClick={handleForgotResend}
              data-testid="forgot-resend-btn"
            >
              {forgotResendSeconds > 0 ? `Gửi lại mã (${forgotResendSeconds}s)` : 'Gửi lại mã'}
            </button>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-new-password">Mật khẩu mới</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="forgot-new-password"
                  className="form-input"
                  type={showForgotNewPassword ? 'text' : 'password'}
                  data-testid="forgot-new-password-input"
                  value={forgotNewPassword}
                  onChange={e => setForgotNewPassword(e.target.value)}
                  style={{ paddingRight: 40 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowForgotNewPassword(prev => !prev)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                  aria-label={showForgotNewPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                >
                  {showForgotNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <PasswordRuleList password={forgotNewPassword} testIdPrefix="forgot-password" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-confirm-password">Nhập lại mật khẩu mới</label>
              <input
                id="forgot-confirm-password"
                className="form-input"
                type={showForgotNewPassword ? 'text' : 'password'}
                data-testid="forgot-confirm-password-input"
                value={forgotConfirmPassword}
                onChange={e => setForgotConfirmPassword(e.target.value)}
                required
              />
            </div>
            {forgotError && (
              <div style={{ color: '#f43f5e', fontSize: '0.85rem', marginBottom: 12 }}>{forgotError}</div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
              disabled={busy}
              data-testid="forgot-reset-btn"
            >
              {flowLoading ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}
            </button>
          </form>
        ) : authView === 'forgot-success' ? (
          <div data-testid="forgot-success-view" style={{ textAlign: 'center', padding: '12px 0' }}>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 18 }}>
              Mật khẩu của bạn đã được đặt lại. Vui lòng đăng nhập lại bằng mật khẩu mới.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
              onClick={() => {
                setAuthTab('login');
                setAuthView('credentials');
              }}
              data-testid="forgot-back-to-login-btn"
            >
              Quay về Đăng nhập
            </button>
          </div>
        ) : authTab === 'login' ? (
          <form onSubmit={onLogin} data-testid="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email đăng nhập</label>
              <input
                id="login-email"
                className="form-input"
                type="email"
                data-testid="login-email-input"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
              />
              {derivedLoginEmailError && (
                <div data-testid="login-email-error" style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: 6 }}>
                  {derivedLoginEmailError}
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
                  onChange={e => setLoginPassword(e.target.value)}
                  style={{ paddingRight: 40 }}
                  required
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
              {loginPasswordError && (
                <div data-testid="login-password-error" style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: 6 }}>
                  {loginPasswordError}
                </div>
              )}
            </div>

            <div
              data-testid="login-recovery-actions"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                margin: '2px 0 12px',
                padding: loginFailureCount >= 2 ? '10px 12px' : 0,
                border: loginFailureCount >= 2 ? '1px solid #f59e0b' : 'none',
                borderRadius: 8,
                background: loginFailureCount >= 2 ? 'rgba(245, 158, 11, 0.13)' : 'transparent',
              }}
            >
              <button
                type="button"
                onClick={startOtpLogin}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontWeight: loginFailureCount >= 2 ? 700 : 500, fontSize: '0.85rem' }}
              >
                Đăng nhập bằng mã OTP
              </button>
              <button
                type="button"
                onClick={startForgotPassword}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontWeight: loginFailureCount >= 2 ? 700 : 500, fontSize: '0.85rem' }}
              >
                Quên mật khẩu?
              </button>
            </div>

            {loginFailureCount >= 3 && loginFailureCount < 5 && (
              <div data-testid="login-attempts-warning" style={{ color: '#f59e0b', fontSize: '0.85rem', marginBottom: 12 }}>
                Còn {5 - loginFailureCount} lần thử trước khi cần xác minh thêm.
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: 10 }}
              disabled={busy}
              data-testid="login-submit-btn"
            >
              {authLoading ? 'Đang xử lý...' : 'Đăng nhập'}
            </button>

            {onFillDemoAccount && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem' }}
                  onClick={onFillDemoAccount}
                  data-testid="demo-account-btn"
                >
                  ⚡ Dùng tài khoản Demo (demo@dafl.vn)
                </button>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={onRegister} data-testid="register-form">
            <div className="form-group">
              <label className="form-label" htmlFor="register-name">Họ và tên</label>
              <input
                id="register-name"
                className="form-input"
                data-testid="register-name-input"
                value={registerName}
                onChange={e => setRegisterName(e.target.value)}
                placeholder="Nguyễn Văn A"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="register-email">Email</label>
              <input
                id="register-email"
                className="form-input"
                type="email"
                data-testid="register-email-input"
                value={registerEmail}
                onChange={e => setRegisterEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
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
                  onChange={e => setRegisterPassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự, gồm chữ hoa & ký tự đặc biệt"
                  style={{ paddingRight: 40 }}
                  required
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
                  onChange={e => setRegisterConfirmPassword && setRegisterConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu để xác nhận"
                  style={{ paddingRight: 40 }}
                  required
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
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="register-phone">Số điện thoại</label>
                <input
                  id="register-phone"
                  className="form-input"
                  data-testid="register-phone-input"
                  value={registerPhone}
                  onChange={e => setRegisterPhone(e.target.value)}
                  placeholder="0987654321"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-address">Địa chỉ</label>
                <input
                  id="register-address"
                  className="form-input"
                  data-testid="register-address-input"
                  value={registerAddress}
                  onChange={e => setRegisterAddress(e.target.value)}
                  placeholder="Hà Nội, VN"
                />
              </div>
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

