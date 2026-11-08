import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthModal } from '../components/auth/AuthModal';
import App from '../App';

const respond = (body: unknown) =>
  Promise.resolve({ json: () => Promise.resolve(body) } as Response);

/**
 * Đăng nhập social (Google/Facebook) đã BỎ HẲN khỏi DAFL — cả shop lẫn admin.
 * File test cũ (TC_SOC_FE_01–05, TC_SOC_APP_01) chỉ kiểm tra nút social /
 * panel mock / đăng nhập mock nên đã vô nghĩa và được thay bằng các test
 * khẳng định form auth KHÔNG còn nút social. Giỏ merge sau đăng nhập
 * (TC_SOC_APP_01 cũ) vẫn được kiểm tra ở AppRoutes.test.tsx qua đăng nhập
 * email; test đặt mật khẩu cho tài khoản chưa có mật khẩu (TC_SOC_APP_02 cũ)
 * vẫn còn giá trị vì tính năng đặt mật khẩu vẫn tồn tại nên được giữ lại.
 */
describe('Social login removed — AuthModal chỉ còn email/mật khẩu', () => {
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

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn(() => respond({ success: true, data: null }));
  });

  it('tab Đăng nhập: không còn nút Google/Facebook, không còn panel mock, form email vẫn đủ', async () => {
    render(<AuthModal {...defaultProps} />);

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('social-google-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-facebook-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-mock-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tiếp tục với Google|Tiếp tục với Facebook/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Môi trường kiểm thử|tài khoản mẫu/)).not.toBeInTheDocument();
    expect(screen.getByTestId('login-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument();
  });

  it('tab Đăng ký: không còn nút Google/Facebook, form đăng ký vẫn đủ', async () => {
    render(<AuthModal {...defaultProps} authTab="register" />);

    expect(screen.getByTestId('register-form')).toBeInTheDocument();
    expect(screen.queryByTestId('social-google-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-facebook-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-mock-panel')).not.toBeInTheDocument();
  });

  it('App: mở trang đăng nhập từ menu tài khoản cũng không còn nút social', async () => {
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/products')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/vouchers')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/notifications')) return respond({ success: true, data: [] });
      return respond({ success: true, data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('account-toggle-btn'));
    fireEvent.click(await screen.findByTestId('dropdown-login-btn'));
    expect(await screen.findByTestId('login-form', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId('social-google-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-facebook-btn')).not.toBeInTheDocument();
  });
});

describe('Set password — tài khoản chưa có mật khẩu (giữ lại từ TC_SOC_APP_02 cũ)', () => {
  it('Tài khoản chưa có mật khẩu thấy form đặt mật khẩu ở trang hồ sơ và đặt được', async () => {
    const socialUser = {
      id: 'user-social-2',
      email: 'user.test@dafl.vn',
      fullName: 'Test User',
      phoneNumber: '',
      address: '',
      role: 'Customer',
      sessionId: 'session-2',
      hasPassword: false,
      authProvider: 'Google',
    };
    // Phiên JWT đã có sẵn trong máy (đăng nhập từ trước).
    localStorage.setItem('dafl_token', 'jwt-2');

    const fetchMock = vi.fn((url: any, _init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: socialUser });
      if (urlStr.includes('/api/auth/set-password')) return respond({ success: true, data: null });
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App />
      </MemoryRouter>
    );

    // Mục Đặt mật khẩu chỉ hiện vì tài khoản chưa có mật khẩu.
    expect(await screen.findByTestId('set-password-form')).toBeInTheDocument();
    expect(screen.getByTestId('set-password-rule-digit')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('set-password-input'), { target: { value: 'Newpass1!' } });
    fireEvent.change(screen.getByTestId('set-password-confirm-input'), { target: { value: 'Newpass1!' } });
    fireEvent.click(screen.getByTestId('set-password-submit-btn'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/auth/set-password')
      );
      expect(call).toBeTruthy();
      // BE SetPasswordRequest chỉ nhận { newPassword }.
      expect(JSON.parse(call[1].body)).toEqual({ newPassword: 'Newpass1!' });
    });
    expect(await screen.findByTestId('set-password-success')).toBeInTheDocument();
    expect(screen.queryByTestId('set-password-form')).not.toBeInTheDocument();
  });
});
