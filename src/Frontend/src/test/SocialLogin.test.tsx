import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthModal } from '../components/auth/AuthModal';
import App from '../App';

const respond = (body: unknown) =>
  Promise.resolve({ json: () => Promise.resolve(body) } as Response);

describe('Social Login (Luồng 6) - AuthModal Component', () => {
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
    // BE test chưa cấu hình provider thật nhưng bật mock → chế độ panel giả lập.
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/social/config')) {
        return respond({
          success: true,
          data: { googleEnabled: false, facebookEnabled: false, mockEnabled: true },
        });
      }
      return respond({ success: true, data: null });
    });
  });

  it('TC_SOC_FE_01: Should show mock social buttons on both tabs with data-mock="true"', async () => {
    render(<AuthModal {...defaultProps} onSocialMockLogin={vi.fn(async () => null)} />);

    const googleBtn = await screen.findByTestId('social-google-btn');
    const facebookBtn = screen.getByTestId('social-facebook-btn');
    expect(googleBtn).toHaveTextContent('Tiếp tục với Google');
    expect(facebookBtn).toHaveTextContent('Tiếp tục với Facebook');
    expect(googleBtn).toHaveAttribute('data-mock', 'true');
    expect(facebookBtn).toHaveAttribute('data-mock', 'true');
  });

  it('TC_SOC_FE_02: Mock Google confirm should call the mock login API handler and close the panel', async () => {
    const onSocialMockLogin = vi.fn(async () => null);
    render(<AuthModal {...defaultProps} onSocialMockLogin={onSocialMockLogin} />);

    fireEvent.click(await screen.findByTestId('social-google-btn'));

    const panel = await screen.findByTestId('social-mock-panel');
    expect(panel).toHaveTextContent('Môi trường kiểm thử');
    expect(panel).toHaveTextContent('google.test@dafl.vn');

    fireEvent.click(screen.getByTestId('social-mock-confirm-btn'));

    await waitFor(() => expect(onSocialMockLogin).toHaveBeenCalledWith('google'));
    await waitFor(() =>
      expect(screen.queryByTestId('social-mock-panel')).not.toBeInTheDocument()
    );
    expect(screen.queryByTestId('social-error')).not.toBeInTheDocument();
  });

  it('TC_SOC_FE_03: Mock Facebook cancel should show the fixed cancellation message and keep the form', async () => {
    const onSocialMockLogin = vi.fn(async () => null);
    render(<AuthModal {...defaultProps} onSocialMockLogin={onSocialMockLogin} />);

    fireEvent.click(await screen.findByTestId('social-facebook-btn'));
    expect(await screen.findByTestId('social-mock-panel')).toHaveTextContent('facebook.test@dafl.vn');

    fireEvent.click(screen.getByTestId('social-mock-cancel-btn'));

    expect(await screen.findByTestId('social-error')).toHaveTextContent(
      'Bạn đã hủy đăng nhập bằng Facebook. Vui lòng thử lại hoặc dùng email và mật khẩu.'
    );
    expect(screen.queryByTestId('social-mock-panel')).not.toBeInTheDocument();
    expect(onSocialMockLogin).not.toHaveBeenCalled();
    // Form đăng nhập vẫn nguyên để thử lại.
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('TC_SOC_FE_04: Social buttons also appear on the register tab', async () => {
    render(
      <AuthModal
        {...defaultProps}
        authTab="register"
        onSocialMockLogin={vi.fn(async () => null)}
      />
    );

    expect(await screen.findByTestId('social-google-btn')).toBeInTheDocument();
    expect(screen.getByTestId('social-facebook-btn')).toBeInTheDocument();
    expect(screen.getByTestId('register-form')).toBeInTheDocument();
  });

  it('TC_SOC_FE_05: A failed mock login should surface the backend error in social-error', async () => {
    const onSocialMockLogin = vi.fn(async () => 'Phiên đăng nhập Google đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.');
    render(<AuthModal {...defaultProps} onSocialMockLogin={onSocialMockLogin} />);

    fireEvent.click(await screen.findByTestId('social-google-btn'));
    fireEvent.click(await screen.findByTestId('social-mock-confirm-btn'));

    expect(await screen.findByTestId('social-error')).toHaveTextContent(
      'Phiên đăng nhập Google đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.'
    );
  });
});

describe('Social Login - App integration (CN-06: guest cart + merge qua social)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('TC_SOC_APP_01: Guest adds freely, then Google mock login posts to /api/auth/social/mock and merges the guest cart', async () => {
    const product = {
      id: 'prod-social',
      categoryId: 'cat-1',
      categoryName: 'Chăm sóc da',
      name: 'Serum DAFL Social',
      slug: 'serum-dafl-social',
      description: 'Serum dùng cho test social login',
      price: 450000,
      originalPrice: 600000,
      availableStock: 10,
      imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600',
      rating: 5,
      reviewCount: 12,
    };
    const socialUser = {
      id: 'user-social',
      email: 'google.test@dafl.vn',
      fullName: 'Google Test User',
      phoneNumber: '',
      address: '',
      role: 'Customer',
      sessionId: 'session-social',
      hasPassword: false,
      authProvider: 'Google',
    };
    const serverCart = {
      id: 'cart-1',
      items: [
        {
          id: 'ci-1',
          productId: 'prod-social',
          productName: 'Serum DAFL Social',
          productImageUrl: product.imageUrl,
          unitPrice: 450000,
          quantity: 1,
          subTotal: 450000,
          availableStock: 10,
          isAvailable: true,
        },
      ],
      totalQuantity: 1,
      totalAmount: 450000,
      notice: null,
    };

    const fetchMock = vi.fn((url: any, _init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/social/config')) {
        return respond({ success: true, data: { googleEnabled: false, facebookEnabled: false, mockEnabled: true } });
      }
      if (urlStr.includes('/api/auth/social/mock')) {
        return respond({ success: true, data: { token: 'jwt-social', user: socialUser } });
      }
      if (urlStr.includes('/api/cart/merge')) return respond({ success: true, data: serverCart });
      if (urlStr.includes('/api/cart')) return respond({ success: true, data: serverCart });
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) {
        return respond({ success: true, data: [{ id: 'cat-1', name: 'Chăm sóc da', slug: 'cham-soc-da' }] });
      }
      if (urlStr.includes('/api/products/prod-social')) return respond({ success: true, data: product });
      if (urlStr.includes('/api/products')) return respond({ success: true, data: [product] });
      if (urlStr.includes('/api/vouchers')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/notifications')) return respond({ success: true, data: [] });
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // CN-06: khách thêm giỏ KHÔNG cần đăng nhập — không còn cổng.
    fireEvent.click(await screen.findByTestId('add-to-cart-btn-prod-social'));
    expect(await screen.findByTestId('cart-added-toast', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId('auth-required-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('cart-badge-count')).toHaveTextContent('1');

    // Khách tự mở trang đăng nhập qua menu tài khoản.
    fireEvent.click(screen.getByTestId('account-toggle-btn'));
    fireEvent.click(await screen.findByTestId('dropdown-login-btn'));
    expect(await screen.findByTestId('login-form', {}, { timeout: 5000 })).toBeInTheDocument();

    // Bấm Google → panel mock → Đồng ý.
    fireEvent.click(await screen.findByTestId('social-google-btn'));
    fireEvent.click(await screen.findByTestId('social-mock-confirm-btn'));

    // API mock được gọi đúng endpoint + provider, token JWT được lưu.
    await waitFor(() => {
      const mockCall = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/auth/social/mock')
      );
      expect(mockCall).toBeTruthy();
      expect(JSON.parse(mockCall[1].body)).toEqual({ provider: 'Google' });
    });
    await waitFor(() => expect(localStorage.getItem('dafl_token')).toBe('jwt-social'));

    // Giỏ khách được merge vào giỏ server sau đăng nhập social.
    await waitFor(() => {
      const mergeCall = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/cart/merge')
      );
      expect(mergeCall).toBeTruthy();
      expect(JSON.parse(mergeCall[1].body)).toEqual({
        items: [{ productId: 'prod-social', quantity: 1 }],
      });
    });
    expect(await screen.findByTestId('cart-badge-count')).toHaveTextContent('1');
    // Sau đăng nhập, App điều hướng khỏi trang auth — chờ route đổi hẳn rồi mới assert.
    await waitFor(
      () => expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument(),
      { timeout: 5000 }
    );
  });

  it('TC_SOC_APP_02: A social account without a password sees the set-password form on the profile page', async () => {
    const socialUser = {
      id: 'user-social-2',
      email: 'google.test@dafl.vn',
      fullName: 'Google Test User',
      phoneNumber: '',
      address: '',
      role: 'Customer',
      sessionId: 'session-social-2',
      hasPassword: false,
      authProvider: 'Google',
    };
    // Phiên JWT đã có sẵn trong máy (đăng nhập social từ trước).
    localStorage.setItem('dafl_token', 'jwt-social-2');

    const fetchMock = vi.fn((url: any, _init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: socialUser });
      if (urlStr.includes('/api/auth/set-password')) return respond({ success: true, data: null });
      if (urlStr.includes('/api/auth/social/config')) {
        return respond({ success: true, data: { googleEnabled: false, facebookEnabled: false, mockEnabled: true } });
      }
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App />
      </MemoryRouter>
    );

    // Mục Đặt mật khẩu chỉ hiện vì tài khoản social chưa có mật khẩu.
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
