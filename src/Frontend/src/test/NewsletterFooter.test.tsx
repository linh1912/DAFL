import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    render(<SiteFooter />);
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
    render(<SiteFooter />);
    await userEvent.type(screen.getByLabelText(/Email của bạn/i), 'a@b.vn');
    await userEvent.click(screen.getByRole('button', { name: /Đăng ký/i }));
    await waitFor(() => {
      expect(screen.getByText(/Vui lòng nhập email đúng định dạng/i)).toBeInTheDocument();
    });
  });
});
