import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AuthModal } from '../components/auth/AuthModal';

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
    registerAddress: '',
    setRegisterAddress: vi.fn(),
    onLogin: vi.fn((e) => e.preventDefault()),
    onRegister: vi.fn((e) => e.preventDefault()),
    onFillDemoAccount: vi.fn(),
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

  it('TC_AUTH_03: Should render registration form fields when authTab is register', () => {
    render(<AuthModal {...defaultProps} authTab="register" />);

    expect(screen.getByTestId('register-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-confirm-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-phone-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-address-input')).toBeInTheDocument();
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

  it('TC_AUTH_05: Should trigger demo account quick-fill', () => {
    const onFillDemoAccount = vi.fn();
    render(<AuthModal {...defaultProps} onFillDemoAccount={onFillDemoAccount} />);

    const demoBtn = screen.getByTestId('demo-account-btn');
    fireEvent.click(demoBtn);
    expect(onFillDemoAccount).toHaveBeenCalledTimes(1);
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

  it('TC_AUTH_10: Should render the exact gate notice when gateNotice is enabled', () => {
    render(<AuthModal {...defaultProps} gateNotice={true} />);

    expect(screen.getByTestId('auth-required-notice')).toHaveTextContent(
      'Bạn chưa đăng nhập. Vui lòng đăng nhập để thêm sản phẩm vào giỏ hàng — hoặc đăng ký nếu chưa có tài khoản.'
    );
  });

  it('TC_AUTH_11: Should show per-field login errors and remaining attempts', () => {
    render(
      <AuthModal
        {...defaultProps}
        loginEmailError="Email không đúng định dạng."
        loginPasswordError="Email hoặc mật khẩu không chính xác."
        loginFailureCount={3}
      />
    );

    expect(screen.getByTestId('login-email-error')).toHaveTextContent('Email không đúng định dạng.');
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('Email hoặc mật khẩu không chính xác.');
    expect(screen.getByTestId('login-attempts-warning')).toHaveTextContent(
      'Còn 2 lần thử trước khi cần xác minh thêm.'
    );
    expect(screen.getByText('Đăng nhập bằng mã OTP')).toBeInTheDocument();
    expect(screen.getByText('Quên mật khẩu?')).toBeInTheDocument();
  });

  it('TC_AUTH_12: Should include the digit rule in the registration password checklist', () => {
    render(<AuthModal {...defaultProps} authTab="register" registerPassword="Password1!" />);

    expect(screen.getByTestId('password-rule-len')).toBeInTheDocument();
    expect(screen.getByTestId('password-rule-upper')).toBeInTheDocument();
    expect(screen.getByTestId('password-rule-digit')).toHaveTextContent('Ít nhất 1 chữ số (0-9)');
    expect(screen.getByTestId('password-rule-special')).toBeInTheDocument();
  });

  it('TC_AUTH_13: Should verify a registration code through six OTP inputs', async () => {
    const onVerifyEmail = vi.fn(async () => null);
    const onResendVerification = vi.fn(async () => null);
    render(
      <AuthModal
        {...defaultProps}
        verificationEmail="new@dafl.vn"
        verificationNotice="Đã gửi mã xác thực về email của bạn."
        onVerifyEmail={onVerifyEmail}
        onResendVerification={onResendVerification}
      />
    );

    expect(screen.getByTestId('register-verify-btn')).toBeInTheDocument();
    expect(screen.getByTestId('register-verify-resend')).toBeDisabled();

    const inputs = within(screen.getByTestId('register-verify-otp-input')).getAllByRole('textbox');
    inputs.forEach((input, index) => fireEvent.change(input, { target: { value: String(index + 1) } }));
    fireEvent.click(screen.getByTestId('register-verify-btn'));

    await waitFor(() => expect(onVerifyEmail).toHaveBeenCalledWith('123456'));
  });

  it('TC_AUTH_14: Should complete OTP login with request and verify callbacks', async () => {
    const onOtpLoginRequest = vi.fn(async () => null);
    const onOtpLoginVerify = vi.fn(async () => null);
    render(
      <AuthModal
        {...defaultProps}
        onOtpLoginRequest={onOtpLoginRequest}
        onOtpLoginVerify={onOtpLoginVerify}
      />
    );

    fireEvent.click(screen.getByText('Đăng nhập bằng mã OTP'));
    fireEvent.change(screen.getByTestId('otp-login-email-input'), {
      target: { value: 'demo@dafl.vn' },
    });
    fireEvent.click(screen.getByTestId('otp-login-send-btn'));

    await waitFor(() => expect(onOtpLoginRequest).toHaveBeenCalledWith('demo@dafl.vn'));
    const inputs = within(await screen.findByTestId('otp-login-code-input')).getAllByRole('textbox');
    inputs.forEach((input, index) => fireEvent.change(input, { target: { value: String(index + 1) } }));
    fireEvent.click(screen.getByTestId('otp-login-verify-btn'));

    await waitFor(() => expect(onOtpLoginVerify).toHaveBeenCalledWith('demo@dafl.vn', '123456'));
  });

  it('TC_AUTH_15: Should complete forgot-password request and reset steps', async () => {
    const onForgotPasswordRequest = vi.fn(async () => null);
    const onResetPassword = vi.fn(async () => null);
    render(
      <AuthModal
        {...defaultProps}
        onForgotPasswordRequest={onForgotPasswordRequest}
        onResetPassword={onResetPassword}
      />
    );

    fireEvent.click(screen.getByText('Quên mật khẩu?'));
    fireEvent.change(screen.getByTestId('forgot-email-input'), {
      target: { value: 'demo@dafl.vn' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit-btn'));

    expect(await screen.findByText(
      'Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.'
    )).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('forgot-otp-input'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('forgot-new-password-input'), {
      target: { value: 'Newpass1!' },
    });
    fireEvent.change(screen.getByTestId('forgot-confirm-password-input'), {
      target: { value: 'Newpass1!' },
    });
    fireEvent.click(screen.getByTestId('forgot-reset-btn'));

    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith(
      'demo@dafl.vn',
      '123456',
      'Newpass1!'
    ));
    expect(await screen.findByTestId('forgot-success-view')).toBeInTheDocument();
  });
});
