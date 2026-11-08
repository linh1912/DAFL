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
    expect(screen.getByText(/GlowMart — Sàn mỹ phẩm đa gian hàng/i)).toBeInTheDocument();
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

  it('lets guests add to cart without logging in (CN-06: no login gate)', async () => {
    const product = {
      id: 'prod-guest',
      categoryId: 'cat-1',
      categoryName: 'Chăm sóc da',
      name: 'Serum DAFL Guest',
      slug: 'serum-dafl-guest',
      description: 'Serum dùng cho test giỏ khách',
      price: 450000,
      originalPrice: 600000,
      availableStock: 10,
      imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600',
      rating: 5,
      reviewCount: 12,
    };
    const respond = (body: unknown) => Promise.resolve({
      json: () => Promise.resolve(body),
    } as Response);

    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) {
        return respond({ success: true, data: [{ id: 'cat-1', name: 'Chăm sóc da', slug: 'cham-soc-da' }] });
      }
      if (urlStr.includes('/api/products/prod-guest')) return respond({ success: true, data: product });
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

    fireEvent.click(await screen.findByTestId('add-to-cart-btn-prod-guest'));

    // Toast xác nhận + badge tăng, KHÔNG hề mở màn hình đăng nhập.
    expect(await screen.findByTestId('cart-added-toast', {}, { timeout: 5000 })).toHaveTextContent('Đã thêm vào giỏ hàng');
    expect(screen.getByTestId('cart-badge-count')).toHaveTextContent('1');
    expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-required-notice')).not.toBeInTheDocument();

    // Giỏ khách được lưu ở localStorage.
    const stored = JSON.parse(localStorage.getItem('dafl_guest_cart') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].product.id).toBe('prod-guest');
    expect(stored[0].quantity).toBe(1);

    // Mở giỏ thấy sản phẩm, vẫn ở trạng thái khách.
    fireEvent.click(screen.getByTestId('cart-btn'));
    expect(await screen.findByTestId('cart-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('cart-item-name-prod-guest')).toHaveTextContent('Serum DAFL Guest');
  });

  it('registers without auto-login, then merges the guest cart on login (CN-01.4 + CN-06.6)', async () => {
    const product = {
      id: 'prod-merge',
      categoryId: 'cat-1',
      categoryName: 'Chăm sóc da',
      name: 'Kem dưỡng DAFL Merge',
      slug: 'kem-duong-dafl-merge',
      description: 'Kem dưỡng dùng cho test merge giỏ',
      price: 320000,
      availableStock: 8,
      imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600',
      rating: 4.9,
      reviewCount: 9,
    };
    const authUser = {
      id: 'user-merge',
      email: 'new@dafl.vn',
      fullName: 'Người dùng Mới',
      phoneNumber: '0912345678',
      address: '',
      role: 'Customer',
      sessionId: 'session-merge',
      hasPassword: true,
    };
    const serverCart = {
      id: 'cart-1',
      items: [
        {
          id: 'ci-1',
          productId: 'prod-merge',
          productName: 'Kem dưỡng DAFL Merge',
          productImageUrl: product.imageUrl,
          unitPrice: 320000,
          quantity: 1,
          subTotal: 320000,
          availableStock: 8,
          isAvailable: true,
        },
      ],
      totalQuantity: 1,
      totalAmount: 320000,
      notice: null,
    };
    const respond = (body: unknown) => Promise.resolve({
      json: () => Promise.resolve(body),
    } as Response);

    const fetchMock = vi.fn((url: any, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/register')) {
        return respond({ success: true, data: { token: 'jwt-register', user: authUser }, message: 'Đăng ký thành công' });
      }
      if (urlStr.includes('/api/auth/login')) {
        return respond({ success: true, data: { token: 'jwt-login', user: authUser } });
      }
      if (urlStr.includes('/api/cart/merge')) return respond({ success: true, data: serverCart });
      if (urlStr.includes('/api/cart')) return respond({ success: true, data: serverCart });
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/categories')) {
        return respond({ success: true, data: [{ id: 'cat-1', name: 'Chăm sóc da', slug: 'cham-soc-da' }] });
      }
      if (urlStr.includes('/api/products/prod-merge')) return respond({ success: true, data: product });
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

    // Khách thêm giỏ trước (không cần đăng nhập).
    fireEvent.click(await screen.findByTestId('add-to-cart-btn-prod-merge'));
    expect(await screen.findByTestId('cart-badge-count')).toHaveTextContent('1');

    // Mở menu tài khoản → Đăng nhập / Đăng ký.
    fireEvent.click(screen.getByTestId('account-toggle-btn'));
    fireEvent.click(await screen.findByTestId('dropdown-login-btn'));
    expect(await screen.findByTestId('login-form', {}, { timeout: 5000 })).toBeInTheDocument();

    // Chuyển tab Đăng ký và đăng ký (không còn ô địa chỉ, không còn bước OTP).
    fireEvent.click(screen.getByTestId('auth-tab-register'));
    fireEvent.change(screen.getByTestId('register-name-input'), { target: { value: 'Người dùng Mới' } });
    fireEvent.change(screen.getByTestId('register-email-input'), { target: { value: 'new@dafl.vn' } });
    fireEvent.change(screen.getByTestId('register-password-input'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByTestId('register-confirm-password-input'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByTestId('register-phone-input'), { target: { value: '0912345678' } });
    fireEvent.click(screen.getByTestId('register-submit-btn'));

    // Đăng ký thành công → về form Đăng nhập kèm thông báo, CHƯA đăng nhập (không có token dùng được).
    expect(await screen.findByTestId('register-success-msg', {}, { timeout: 5000 })).toHaveTextContent('Đăng ký thành công');
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(localStorage.getItem('dafl_token')).toBeNull();

    // Đăng nhập → merge giỏ khách vào giỏ server.
    fireEvent.change(screen.getByTestId('login-password-input'), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByTestId('login-submit-btn'));

    await waitFor(() => {
      const mergeCall = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/cart/merge')
      );
      expect(mergeCall).toBeTruthy();
      expect(JSON.parse(mergeCall![1].body)).toEqual({
        items: [{ productId: 'prod-merge', quantity: 1 }],
      });
    });
    expect(localStorage.getItem('dafl_token')).toBe('jwt-login');
    expect(localStorage.getItem('dafl_guest_cart')).toBeNull();
    expect(await screen.findByTestId('cart-badge-count')).toHaveTextContent('1');
  });
});
