import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AuthModal } from '../../../Shared/components/auth/AuthModal';

describe('Authentication Module - AuthModal Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    authTab: 'login' as const,
    setAuthTab: vi.fn(),
    authError: null,
    authLoading: false,
    loginEmail: '',
    setLoginEmail: vi.fn(),
    loginPassword: '',
    setLoginPassword: vi.fn(),
    registerName: '',
    setRegisterName: vi.fn(),
    registerEmail: '',
    setRegisterEmail: vi.fn(),
    registerPassword: '',
    setRegisterPassword: vi.fn(),
    registerConfirmPassword: '',
    setRegisterConfirmPassword: vi.fn(),
    registerPhone: '',
    setRegisterPhone: vi.fn(),
    onLogin: vi.fn((e) => e.preventDefault()),
    onRegister: vi.fn((e) => e.preventDefault()),
  };

  // Harness có state thật để test được validate phía client của AuthModal.
  const renderStatefulAuthModal = (extraProps: Record<string, unknown> = {}) => {
    const onLogin = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    const onRegister = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    const onClearAuthErrors = vi.fn();

    const Harness = () => {
      const [tab, setTab] = React.useState<'login' | 'register'>('login');
      const [loginEmail, setLoginEmail] = React.useState('');
      const [loginPassword, setLoginPassword] = React.useState('');
      const [name, setName] = React.useState('');
      const [email, setEmail] = React.useState('');
      const [password, setPassword] = React.useState('');
      const [confirmPassword, setConfirmPassword] = React.useState('');
      const [phone, setPhone] = React.useState('');
      return (
        <AuthModal
          {...defaultProps}
          authTab={tab}
          setAuthTab={setTab}
          loginEmail={loginEmail}
          setLoginEmail={setLoginEmail}
          loginPassword={loginPassword}
          setLoginPassword={setLoginPassword}
          registerName={name}
          setRegisterName={setName}
          registerEmail={email}
          setRegisterEmail={setEmail}
          registerPassword={password}
          setRegisterPassword={setPassword}
          registerConfirmPassword={confirmPassword}
          setRegisterConfirmPassword={setConfirmPassword}
          registerPhone={phone}
          setRegisterPhone={setPhone}
          onLogin={onLogin}
          onRegister={onRegister}
          onClearAuthErrors={onClearAuthErrors}
          {...extraProps}
        />
      );
    };

    const utils = render(<Harness />);
    return { ...utils, onLogin, onRegister, onClearAuthErrors };
  };

  // ==========================================
  // Positive Path Test Cases (70%)
  // ==========================================
  it('TC_AUTH_01: Should render login form elements by default', () => {
    render(<AuthModal {...defaultProps} />);

    expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
    expect(screen.getByTestId('auth-tab-login')).toHaveClass('active');
    expect(screen.getByTestId('login-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit-btn')).toHaveTextContent('Đăng nhập');
  });

  it('TC_AUTH_02: Should allow switching to register tab', () => {
    const setAuthTab = vi.fn();
    render(<AuthModal {...defaultProps} setAuthTab={setAuthTab} />);

    const registerTabBtn = screen.getByTestId('auth-tab-register');
    fireEvent.click(registerTabBtn);
    expect(setAuthTab).toHaveBeenCalledWith('register');
  });

  it('TC_AUTH_03: Should render registration form fields when authTab is register (CN-01: no address field)', () => {
    render(<AuthModal {...defaultProps} authTab="register" />);

    expect(screen.getByTestId('register-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-confirm-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-phone-input')).toBeInTheDocument();
    // CN-01: form đăng ký KHÔNG còn ô địa chỉ (địa chỉ thuộc sổ địa chỉ CN-03.3).
    expect(screen.queryByTestId('register-address-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('register-submit-btn')).toHaveTextContent('Đăng ký ngay');
  });

  it('TC_AUTH_04: Should call onLogin when submitting valid credentials', () => {
    const onLogin = vi.fn((e) => e.preventDefault());
    render(
      <AuthModal
        {...defaultProps}
        loginEmail="demo@dafl.vn"
        loginPassword="Password123!"
        onLogin={onLogin}
      />
    );

    const submitBtn = screen.getByTestId('login-submit-btn');
    fireEvent.click(submitBtn);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('TC_AUTH_06: Should call onClose when clicking close button', () => {
    const onClose = vi.fn();
    render(<AuthModal {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByTestId('auth-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ==========================================
  // Negative Path Test Cases (30%)
  // ==========================================
  it('TC_AUTH_07: Should display error message alert when authError is present', () => {
    const errorMessage = 'Email hoặc mật khẩu không chính xác!';
    render(<AuthModal {...defaultProps} authError={errorMessage} />);

    const errorBox = screen.getByTestId('auth-error-msg');
    expect(errorBox).toBeInTheDocument();
    expect(errorBox).toHaveTextContent(errorMessage);
  });

  it('TC_AUTH_08: Should disable submit button and show loading text when authLoading is true', () => {
    render(<AuthModal {...defaultProps} authLoading={true} />);

    const submitBtn = screen.getByTestId('login-submit-btn');
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Đang xử lý...');
  });

  it('TC_AUTH_09: Should not render anything when isOpen is false', () => {
    const { container } = render(<AuthModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('TC_AUTH_10: CN removes the gate notice, OTP verification and lockout UI (forgot-password is back in wave 13)', () => {
    render(<AuthModal {...defaultProps} />);

    expect(screen.queryByTestId('auth-required-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('register-verify-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-attempts-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Đăng nhập bằng mã OTP')).not.toBeInTheDocument();
    // Đợt 13, mục 1: link "Quên mật khẩu" đã trở lại — xem TC_AUTH_25.
    expect(screen.getByTestId('forgot-password-link')).toBeInTheDocument();
  });

  it('TC_AUTH_11: Should show per-field login errors from props', () => {
    render(
      <AuthModal
        {...defaultProps}
        loginEmailError="Email không đúng định dạng."
        loginPasswordError="Email hoặc mật khẩu không đúng"
      />
    );

    expect(screen.getByTestId('login-email-error')).toHaveTextContent('Email không đúng định dạng.');
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('Email hoặc mật khẩu không đúng');
    expect(screen.queryByTestId('login-attempts-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Đăng nhập bằng mã OTP')).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-account-btn')).not.toBeInTheDocument();
  });

  it('TC_AUTH_12: Should include the digit rule in the registration password checklist', () => {
    render(<AuthModal {...defaultProps} authTab="register" registerPassword="Password1!" />);

    expect(screen.getByTestId('password-rule-len')).toBeInTheDocument();
    expect(screen.getByTestId('password-rule-upper')).toBeInTheDocument();
    expect(screen.getByTestId('password-rule-digit')).toHaveTextContent('Ít nhất 1 chữ số (0-9)');
    expect(screen.getByTestId('password-rule-special')).toBeInTheDocument();
  });

  // ==========================================
  // v3.1: bỏ OTP-login + nút demo, validate client theo từng ô
  // ==========================================
  it('TC_AUTH_16: Login form uses noValidate and shows per-field errors instead of calling onLogin', () => {
    const onLogin = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<AuthModal {...defaultProps} onLogin={onLogin} />);

    expect(screen.getByTestId('login-form')).toHaveAttribute('novalidate');
    expect(screen.getByTestId('login-email-input')).not.toBeRequired();
    expect(screen.getByTestId('login-password-input')).not.toBeRequired();

    fireEvent.click(screen.getByTestId('login-submit-btn'));

    expect(screen.getByTestId('login-email-error')).toHaveTextContent('Email không được để trống.');
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('Mật khẩu không được để trống.');
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('TC_AUTH_17: Credential error is shown only under the password field, never duplicated in the banner', () => {
    render(
      <AuthModal
        {...defaultProps}
        authError="Email hoặc mật khẩu không chính xác."
        loginPasswordError="Email hoặc mật khẩu không chính xác."
      />
    );

    expect(screen.queryByTestId('auth-error-msg')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-password-error')).toHaveTextContent(
      'Email hoặc mật khẩu không chính xác.'
    );
  });

  it('TC_AUTH_18: Switching tabs clears all field errors', () => {
    const { onClearAuthErrors } = renderStatefulAuthModal();

    fireEvent.click(screen.getByTestId('login-submit-btn'));
    expect(screen.getByTestId('login-email-error')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('auth-tab-register'));
    expect(onClearAuthErrors).toHaveBeenCalled();
    expect(screen.queryByTestId('login-email-error')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('auth-tab-login'));
    expect(screen.queryByTestId('login-email-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-password-error')).not.toBeInTheDocument();
  });

  it('TC_AUTH_19: Register submit validates every field with a red message under it (CN-01 messages)', () => {
    const { onRegister } = renderStatefulAuthModal();
    fireEvent.click(screen.getByTestId('auth-tab-register'));

    expect(screen.getByTestId('register-form')).toHaveAttribute('novalidate');
    fireEvent.click(screen.getByTestId('register-submit-btn'));

    expect(screen.getByTestId('register-name-error')).toHaveTextContent('Họ tên không hợp lệ');
    expect(screen.getByTestId('register-email-error')).toHaveTextContent('Vui lòng nhập email.');
    expect(screen.getByTestId('register-password-error')).toHaveTextContent('Vui lòng nhập mật khẩu.');
    expect(screen.getByTestId('register-confirm-password-error')).toHaveTextContent('Vui lòng nhập lại mật khẩu.');
    expect(screen.getByTestId('register-phone-error')).toHaveTextContent('Số điện thoại không hợp lệ');
    expect(screen.queryByTestId('register-address-error')).not.toBeInTheDocument();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it('TC_AUTH_20: Register shows mismatch under confirm field, trims values and submits when valid', () => {
    const { onRegister } = renderStatefulAuthModal();
    fireEvent.click(screen.getByTestId('auth-tab-register'));

    fireEvent.change(screen.getByTestId('register-name-input'), { target: { value: '  Nguyễn Văn A  ' } });
    fireEvent.change(screen.getByTestId('register-email-input'), { target: { value: '  New@DAFL.vn ' } });
    fireEvent.change(screen.getByTestId('register-password-input'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByTestId('register-confirm-password-input'), { target: { value: 'Password2!' } });
    fireEvent.change(screen.getByTestId('register-phone-input'), { target: { value: ' 0912345678 ' } });
    fireEvent.click(screen.getByTestId('register-submit-btn'));

    expect(screen.getByTestId('register-confirm-password-error')).toHaveTextContent(
      'Mật khẩu xác nhận không khớp'
    );
    expect(onRegister).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('register-confirm-password-input'), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByTestId('register-submit-btn'));

    expect(onRegister).toHaveBeenCalledTimes(1);
    const submittedValues = onRegister.mock.calls[0][1];
    expect(submittedValues).toEqual({
      fullName: 'Nguyễn Văn A',
      email: 'new@dafl.vn',
      password: 'Password1!',
      phoneNumber: '0912345678',
    });
  });

  it('TC_AUTH_21: Password checklist turns each rule green as it becomes satisfied', () => {
    render(<AuthModal {...defaultProps} authTab="register" registerPassword="Pass" />);

    expect(screen.getByTestId('password-rule-upper')).toHaveStyle({ color: 'rgb(22, 163, 74)' });
    expect(screen.getByTestId('password-rule-upper')).toHaveTextContent('✓');
    expect(screen.getByTestId('password-rule-len')).not.toHaveStyle({ color: 'rgb(22, 163, 74)' });
  });

  // ==========================================
  // CN-01.4 / CN-02 E3: thông báo sau đăng ký + phiên hết hạn + lỗi field từ BE
  // ==========================================
  it('TC_AUTH_22: Register success message is shown on the login tab after registration (CN-01.4)', () => {
    render(<AuthModal {...defaultProps} registerSuccess={true} />);

    expect(screen.getByTestId('register-success-msg')).toHaveTextContent('Đăng ký thành công');
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('TC_AUTH_23: Session expired notice is shown when sessionExpired is set (CN-02 E3)', () => {
    render(<AuthModal {...defaultProps} sessionExpired={true} />);

    expect(screen.getByTestId('session-expired-notice')).toHaveTextContent(
      'Phiên đăng nhập đã hết hạn'
    );
  });

  it('TC_AUTH_24: Server-side register field errors are shown under the matching fields', () => {
    render(
      <AuthModal
        {...defaultProps}
        authTab="register"
        registerFieldErrors={{
          email: 'Email đã được sử dụng',
          phone: 'Số điện thoại đã được sử dụng',
        }}
      />
    );

    expect(screen.getByTestId('register-email-error')).toHaveTextContent('Email đã được sử dụng');
    expect(screen.getByTestId('register-phone-error')).toHaveTextContent('Số điện thoại đã được sử dụng');
  });

  // ==========================================
  // Đợt 13, mục 1: quên mật khẩu — gửi mã 6 số qua email thật (SMTP)
  // ==========================================
  const mockFetchOk = (body: unknown, status = 200) =>
    vi.fn().mockResolvedValue({ status, json: async () => body });

  const openForgotForm = () => {
    render(<AuthModal {...defaultProps} />);
    fireEvent.click(screen.getByTestId('forgot-password-link'));
    expect(screen.getByTestId('forgot-password-form')).toBeInTheDocument();
  };

  it('TC_AUTH_25: Forgot-password link is shown on the login tab (shop) and in admin-only mode', () => {
    const { unmount } = render(<AuthModal {...defaultProps} />);
    expect(screen.getByTestId('forgot-password-link')).toHaveTextContent('Quên mật khẩu?');
    unmount();

    render(<AuthModal {...defaultProps} adminOnly />);
    expect(screen.getByTestId('forgot-password-link')).toBeInTheDocument();
    // Admin vẫn chỉ có form đăng nhập, không có tab đăng ký.
    expect(screen.queryByTestId('auth-tab-register')).not.toBeInTheDocument();
  });

  it('TC_AUTH_26: Clicking the link opens the forgot form; back link returns to login', () => {
    openForgotForm();

    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-submit-btn')).toHaveTextContent('Gửi mã đặt lại');

    fireEvent.click(screen.getByTestId('forgot-password-back-btn'));
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-form')).not.toBeInTheDocument();
  });

  it('TC_AUTH_27: Forgot submit with empty/invalid email shows an error and does not call the API', () => {
    const fetchMock = mockFetchOk({ success: true, message: 'ok', data: null });
    vi.stubGlobal('fetch', fetchMock);
    try {
      openForgotForm();

      fireEvent.click(screen.getByTestId('forgot-password-submit-btn'));
      expect(screen.getByTestId('forgot-password-email-error')).toHaveTextContent('Vui lòng nhập email.');

      fireEvent.change(screen.getByTestId('forgot-password-email-input'), { target: { value: 'khong-phai-email' } });
      fireEvent.click(screen.getByTestId('forgot-password-submit-btn'));
      expect(screen.getByTestId('forgot-password-email-error')).toHaveTextContent('Email không đúng định dạng.');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('TC_AUTH_28: Valid email calls POST /api/auth/forgot-password and shows the reset form', async () => {
    const fetchMock = mockFetchOk({ success: true, message: 'Nếu email tồn tại, mã đặt lại đã được gửi.', data: null });
    vi.stubGlobal('fetch', fetchMock);
    try {
      openForgotForm();

      fireEvent.change(screen.getByTestId('forgot-password-email-input'), { target: { value: 'demo@dafl.vn' } });
      fireEvent.click(screen.getByTestId('forgot-password-submit-btn'));

      await waitFor(() => expect(screen.getByTestId('reset-password-form')).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/forgot-password');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'demo@dafl.vn' });
      expect(screen.getByTestId('forgot-password-notice')).toHaveTextContent('Nếu email tồn tại, mã đặt lại đã được gửi.');
      expect(screen.getByTestId('reset-code-input')).toBeInTheDocument();
      expect(screen.getByTestId('reset-new-password-input')).toBeInTheDocument();
      expect(screen.getByTestId('reset-confirm-password-input')).toBeInTheDocument();
      expect(screen.getByTestId('reset-password-submit-btn')).toHaveTextContent('Đặt lại mật khẩu');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('TC_AUTH_29: Reset form validates code, password policy and confirmation before calling the API', async () => {
    const fetchMock = mockFetchOk({ success: true, message: 'Nếu email tồn tại, mã đặt lại đã được gửi.', data: null });
    vi.stubGlobal('fetch', fetchMock);
    try {
      openForgotForm();
      fireEvent.change(screen.getByTestId('forgot-password-email-input'), { target: { value: 'demo@dafl.vn' } });
      fireEvent.click(screen.getByTestId('forgot-password-submit-btn'));
      await waitFor(() => expect(screen.getByTestId('reset-password-form')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));
      expect(screen.getByTestId('reset-code-error')).toHaveTextContent('Mã đặt lại gồm 6 chữ số.');
      expect(screen.getByTestId('reset-new-password-error')).toHaveTextContent('Vui lòng nhập mật khẩu mới.');
      expect(screen.getByTestId('reset-confirm-password-error')).toHaveTextContent('Vui lòng nhập lại mật khẩu.');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByTestId('reset-code-input'), { target: { value: '123' } });
      fireEvent.change(screen.getByTestId('reset-new-password-input'), { target: { value: 'yeu123' } });
      fireEvent.change(screen.getByTestId('reset-confirm-password-input'), { target: { value: 'yeu123' } });
      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));
      expect(screen.getByTestId('reset-code-error')).toHaveTextContent('Mã đặt lại gồm 6 chữ số.');
      expect(screen.getByTestId('reset-new-password-error')).toHaveTextContent('Mật khẩu chưa đáp ứng đủ các điều kiện bảo mật bên dưới.');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByTestId('reset-code-input'), { target: { value: '123456' } });
      fireEvent.change(screen.getByTestId('reset-new-password-input'), { target: { value: 'Password1!' } });
      fireEvent.change(screen.getByTestId('reset-confirm-password-input'), { target: { value: 'Password2!' } });
      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));
      expect(screen.getByTestId('reset-confirm-password-error')).toHaveTextContent('Mật khẩu xác nhận không khớp');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('TC_AUTH_30: Valid code + new password calls POST /api/auth/reset-password and shows success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, message: 'Nếu email tồn tại, mã đặt lại đã được gửi.', data: null }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.', data: 'Đặt lại mật khẩu thành công.' }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      openForgotForm();
      fireEvent.change(screen.getByTestId('forgot-password-email-input'), { target: { value: 'demo@dafl.vn' } });
      fireEvent.click(screen.getByTestId('forgot-password-submit-btn'));
      await waitFor(() => expect(screen.getByTestId('reset-password-form')).toBeInTheDocument());

      fireEvent.change(screen.getByTestId('reset-code-input'), { target: { value: '123456' } });
      fireEvent.change(screen.getByTestId('reset-new-password-input'), { target: { value: 'Password1!' } });
      fireEvent.change(screen.getByTestId('reset-confirm-password-input'), { target: { value: 'Password1!' } });
      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));

      await waitFor(() => expect(screen.getByTestId('forgot-password-success')).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/reset-password');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        email: 'demo@dafl.vn',
        code: '123456',
        newPassword: 'Password1!',
        confirmNewPassword: 'Password1!',
      });
      expect(screen.getByTestId('forgot-password-success')).toHaveTextContent('Đặt lại mật khẩu thành công');

      fireEvent.click(screen.getByTestId('forgot-password-back-btn'));
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

