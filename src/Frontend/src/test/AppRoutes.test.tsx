import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

describe('App Routing & Navigation System (React Router)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();

    // Mock fetch for API endpoints called in App
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;

      if (urlStr.includes('/api/auth/me')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: false, data: null, message: 'Unauthorized' }),
        } as Response);
      }

      if (urlStr.includes('/api/products/categories')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: [] }),
        } as Response);
      }

      if (urlStr.includes('/api/products')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: [] }),
        } as Response);
      }

      if (urlStr.includes('/api/vouchers')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: [] }),
        } as Response);
      }

      if (urlStr.includes('/api/notifications')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: [] }),
        } as Response);
      }

      return Promise.resolve({
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response);
    });
  });

  it('renders home page by default on "/"', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByText(/Sàn Thương Mại Điện Tử DAFL/i)).toBeInTheDocument();
  });

  it('renders Cart & Checkout view on "/cart"', async () => {
    render(
      <MemoryRouter initialEntries={['/cart']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cart-drawer')).toBeInTheDocument();
    });
  });

  it('renders Login view on "/login"', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
      expect(screen.getByTestId('auth-tab-login')).toHaveClass('active');
    });
  });

  it('renders Register view on "/register"', async () => {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
      expect(screen.getByTestId('auth-tab-register')).toHaveClass('active');
    });
  });

  it('redirects unauthenticated user from protected route "/orders" to "/login"', async () => {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <App />
      </MemoryRouter>
    );

    // Wait for auth check to finish and redirect to login
    await waitFor(() => {
      expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated user from protected route "/profile" to "/login"', async () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
    });
  });

  it('renders Product Detail view on "/product/:id" without infinite loop', async () => {
    render(
      <MemoryRouter initialEntries={['/product/prod-demo']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('product-detail-page')).toBeInTheDocument();
    });
  });

  it('opens notifications modal when clicking bell button', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTestId('notif-bell-btn');
    bellBtn.click();

    await waitFor(() => {
      expect(screen.getByTestId('notifications-modal')).toBeInTheDocument();
    });
  });

  it('gates add-to-cart for guests and executes the pending add after login', async () => {
    const product = {
      id: 'prod-gate',
      categoryId: 'cat-1',
      categoryName: 'Chăm sóc da',
      name: 'Serum DAFL Gate',
      slug: 'serum-dafl-gate',
      description: 'Serum dùng cho test cổng đăng nhập',
      price: 450000,
      originalPrice: 600000,
      availableStock: 10,
      imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600',
      rating: 5,
      reviewCount: 12,
    };
    const authUser = {
      id: 'user-gate',
      email: 'demo@dafl.vn',
      fullName: 'Người dùng Gate',
      phoneNumber: '0987654321',
      address: 'Hà Nội',
      role: 'Customer',
      sessionId: 'session-gate',
    };
    const respond = (body: unknown) => Promise.resolve({
      json: () => Promise.resolve(body),
    } as Response);

    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/login')) return respond({ success: true, data: authUser });
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) {
        return respond({ success: true, data: [{ id: 'cat-1', name: 'Chăm sóc da', slug: 'cham-soc-da' }] });
      }
      if (urlStr.includes('/api/products')) return respond({ success: true, data: [product] });
      if (urlStr.includes('/api/vouchers')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/notifications')) return respond({ success: true, data: [] });
      return respond({ success: true, data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('add-to-cart-btn-prod-gate'));
    expect(await screen.findByTestId('auth-required-notice')).toHaveTextContent('Bạn chưa đăng nhập');
    expect(screen.queryByTestId('cart-badge-count')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'demo@dafl.vn' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByTestId('login-submit-btn'));

    expect(await screen.findByTestId('cart-drawer')).toBeInTheDocument();
    expect(await screen.findByText('Serum DAFL Gate')).toBeInTheDocument();
    expect(screen.getByTestId('cart-badge-count')).toHaveTextContent('1');
  });

  it('moves registration to email verification and then executes the pending add', async () => {
    const product = {
      id: 'prod-register-gate',
      categoryId: 'cat-1',
      categoryName: 'Chăm sóc da',
      name: 'Kem dưỡng DAFL Gate',
      slug: 'kem-duong-dafl-gate',
      description: 'Kem dưỡng dùng cho test xác thực đăng ký',
      price: 320000,
      availableStock: 8,
      imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600',
      rating: 4.9,
      reviewCount: 9,
    };
    const authUser = {
      id: 'user-register-gate',
      email: 'new@dafl.vn',
      fullName: 'Người dùng Mới',
      phoneNumber: '0912345678',
      address: 'Hà Nội, Việt Nam',
      role: 'Customer',
      sessionId: 'session-register-gate',
    };
    const respond = (body: unknown) => Promise.resolve({
      json: () => Promise.resolve(body),
    } as Response);

    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/register')) {
        return respond({
          success: true,
          data: { email: 'new@dafl.vn', requiresVerification: true },
          message: 'Đã gửi mã xác thực về email của bạn.',
        });
      }
      if (urlStr.includes('/api/auth/verify-email')) return respond({ success: true, data: authUser });
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) {
        return respond({ success: true, data: [{ id: 'cat-1', name: 'Chăm sóc da', slug: 'cham-soc-da' }] });
      }
      if (urlStr.includes('/api/products')) return respond({ success: true, data: [product] });
      if (urlStr.includes('/api/vouchers')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/notifications')) return respond({ success: true, data: [] });
      return respond({ success: true, data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('add-to-cart-btn-prod-register-gate'));
    fireEvent.click(await screen.findByTestId('auth-tab-register'));
    fireEvent.change(screen.getByTestId('register-name-input'), {
      target: { value: 'Người dùng Mới' },
    });
    fireEvent.change(screen.getByTestId('register-email-input'), {
      target: { value: 'new@dafl.vn' },
    });
    fireEvent.change(screen.getByTestId('register-password-input'), {
      target: { value: 'Password1!' },
    });
    fireEvent.change(screen.getByTestId('register-confirm-password-input'), {
      target: { value: 'Password1!' },
    });
    fireEvent.change(screen.getByTestId('register-phone-input'), {
      target: { value: '0912345678' },
    });
    fireEvent.change(screen.getByTestId('register-address-input'), {
      target: { value: 'Hà Nội, Việt Nam' },
    });
    fireEvent.click(screen.getByTestId('register-submit-btn'));

    expect(await screen.findByTestId('register-verify-btn')).toBeInTheDocument();
    const codeInputs = within(screen.getByTestId('register-verify-otp-input')).getAllByRole('textbox');
    codeInputs.forEach((input, index) => fireEvent.change(input, {
      target: { value: String(index + 1) },
    }));
    fireEvent.click(screen.getByTestId('register-verify-btn'));

    expect(await screen.findByTestId('cart-drawer')).toBeInTheDocument();
    expect(await screen.findByText('Kem dưỡng DAFL Gate')).toBeInTheDocument();
  });
});
