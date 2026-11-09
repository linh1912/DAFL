import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SiteFooter } from '../components/common/SiteFooter';

const respond = (status: number, body: unknown) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) } as unknown as Response);

describe('SiteFooter — đăng ký bản tin thật qua POST /api/newsletter/subscribe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('đăng ký thành công khi BE trả success', async () => {
    globalThis.fetch = vi.fn(() =>
      respond(200, { success: true, data: 'a@b.vn', message: 'Cảm ơn bạn đã đăng ký nhận bản tin DAFL.' })
    );
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
      </MemoryRouter>
    );
    await userEvent.type(screen.getByLabelText(/Email của bạn/i), 'a@b.vn');
    await userEvent.click(screen.getByRole('button', { name: /Đăng ký/i }));
    await waitFor(() => {
      expect(screen.getByText(/Cảm ơn bạn đã đăng ký nhận bản tin DAFL/i)).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/newsletter/subscribe'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('hiện đúng lỗi BE khi email không hợp lệ', async () => {
    globalThis.fetch = vi.fn(() =>
      respond(400, { success: false, message: 'Vui lòng nhập email đúng định dạng.' })
    );
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
      </MemoryRouter>
    );
    await userEvent.type(screen.getByLabelText(/Email của bạn/i), 'a@b.vn');
    await userEvent.click(screen.getByRole('button', { name: /Đăng ký/i }));
    await waitFor(() => {
      expect(screen.getByText(/Vui lòng nhập email đúng định dạng/i)).toBeInTheDocument();
    });
  });
});

/**
 * Đợt 13 mục 6: mọi mục footer là liên kết thật tới route có thật trong
 * src/Frontend/src/App.tsx. Route có thật: / /cart /orders /profile
 * /product/:id /login /register /payment/:orderCode /mock-payos
 * /payment-success /membership (trang Hội viên riêng, đợt 13 mục 2)
 * (không có route riêng cho danh mục, chính sách,
 * FAQ, giới thiệu, gian hàng, tạp chí, liên hệ → về trang chủ /).
 */
describe('SiteFooter — liên kết thật (đợt 13 mục 6)', () => {
  const FOOTER_LINKS: Array<[string, string]> = [
    ['footer-link-category-skincare', '/'],
    ['footer-link-category-makeup', '/'],
    ['footer-link-category-hair', '/'],
    ['footer-link-category-body', '/'],
    ['footer-link-flash-sale', '/'],
    ['footer-link-guide', '/'],
    ['footer-link-shipping', '/cart'],
    ['footer-link-returns', '/orders'],
    ['footer-link-track-order', '/orders'],
    ['footer-link-faq', '/'],
    ['footer-link-about', '/'],
    ['footer-link-shops', '/'],
    ['footer-link-magazine', '/'],
    ['footer-link-member', '/membership'],
    ['footer-link-contact', '/'],
  ];

  const LocationProbe = () => {
    const location = useLocation();
    return <div data-testid="location-probe">{location.pathname}</div>;
  };

  it('15 mục footer đều là <a> tới route có thật, không còn chữ thuần', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
      </MemoryRouter>
    );
    for (const [testid, href] of FOOTER_LINKS) {
      const link = screen.getByTestId(testid);
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('bấm "Tra cứu đơn hàng" chuyển sang /orders', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
        <LocationProbe />
      </MemoryRouter>
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/');
    await userEvent.click(screen.getByTestId('footer-link-track-order'));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/orders');
    });
  });

  it('bấm "DAFL Member" chuyển sang /membership', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
        <LocationProbe />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByTestId('footer-link-member'));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/membership');
    });
  });
});
