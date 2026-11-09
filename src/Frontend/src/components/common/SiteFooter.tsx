import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CreditCard, Mail, MapPin, Phone } from 'lucide-react';
import { apiJson } from '../../../../Shared/utils/api';

export const SiteFooter: React.FC = () => {
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [newsletterError, setNewsletterError] = useState('');
  const [newsletterBusy, setNewsletterBusy] = useState(false);

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletterEmail.trim())) {
      setNewsletterError('Vui lòng nhập email đúng định dạng.');
      return;
    }
    setNewsletterError('');
    setNewsletterBusy(true);
    try {
      // Đăng ký thật qua BE: POST /api/newsletter/subscribe (lưu vào DB).
      const { status, body } = await apiJson<string>('/api/newsletter/subscribe', {
        method: 'POST',
        body: JSON.stringify({ email: newsletterEmail.trim() }),
      });
      if (status >= 200 && status < 300 && body?.success) {
        setNewsletterDone(true);
      } else {
        setNewsletterError(body?.message ?? 'Đăng ký thất bại. Vui lòng thử lại sau.');
      }
    } catch {
      setNewsletterError('Không kết nối được máy chủ. Vui lòng thử lại sau.');
    } finally {
      setNewsletterBusy(false);
    }
  };

  return (
    <div className="site-chrome">
      <section className="newsletter-band" aria-labelledby="newsletter-title">
        <div className="newsletter-copy">
          <h2 id="newsletter-title">Ưu đãi mỹ phẩm mỗi tuần</h2>
          <p>Deal làm đẹp và mã giảm giá gửi thẳng tới hộp thư của bạn.</p>
        </div>
        {newsletterDone ? (
          <p className="newsletter-success">
            <CheckCircle2 size={19} /> Cảm ơn bạn đã đăng ký nhận bản tin DAFL.
          </p>
        ) : (
          <form className="newsletter-form" onSubmit={handleNewsletterSubmit} noValidate>
            <label className="newsletter-label" htmlFor="newsletter-email">
              <Mail size={17} />
              <span>Email của bạn</span>
            </label>
            <div className="newsletter-control">
              <input
                id="newsletter-email"
                type="email"
                value={newsletterEmail}
                onChange={e => setNewsletterEmail(e.target.value)}
                placeholder="Nhập email của bạn"
              />
              <button type="submit" disabled={newsletterBusy}>{newsletterBusy ? 'Đang đăng ký...' : 'Đăng ký'}</button>
            </div>
            {newsletterError && <span className="newsletter-error">{newsletterError}</span>}
          </form>
        )}
      </section>

      <footer className="site-footer">
        <div className="site-footer-brand">
          <div className="site-footer-logo">DAFL</div>
          <p>Mỹ phẩm chính hãng từ nhiều gian hàng, giá rõ ràng.</p>
          <p className="site-footer-contact">
            <Phone size={14} /> Hotline 1900 0000 (8h–21h)
          </p>
          <p className="site-footer-contact">
            <MapPin size={14} /> Gian hàng DAFL trên toàn quốc
          </p>
        </div>

        <nav aria-label="Mua sắm tại DAFL">
          <h3>Mua sắm</h3>
          <ul>
            {/* Danh mục mỹ phẩm chưa có route riêng — về trang chủ (danh mục + Flash Sale đều ở đó). */}
            <li><Link to="/" data-testid="footer-link-category-skincare">Chăm sóc da</Link></li>
            <li><Link to="/" data-testid="footer-link-category-makeup">Trang điểm</Link></li>
            <li><Link to="/" data-testid="footer-link-category-hair">Chăm sóc tóc</Link></li>
            <li><Link to="/" data-testid="footer-link-category-body">Cơ thể &amp; nước hoa</Link></li>
            <li><Link to="/" data-testid="footer-link-flash-sale">Flash Sale</Link></li>
          </ul>
        </nav>

        <nav aria-label="Hỗ trợ khách hàng DAFL">
          <h3>Hỗ trợ khách hàng</h3>
          <ul>
            <li><Link to="/" data-testid="footer-link-guide">Hướng dẫn mua hàng</Link></li>
            <li><Link to="/cart" data-testid="footer-link-shipping">Chính sách vận chuyển</Link></li>
            <li><Link to="/orders" data-testid="footer-link-returns">Đổi trả trong 30 ngày</Link></li>
            <li><Link to="/orders" data-testid="footer-link-track-order">Tra cứu đơn hàng</Link></li>
            <li><Link to="/" data-testid="footer-link-faq">Câu hỏi thường gặp</Link></li>
          </ul>
        </nav>

        <nav aria-label="Về DAFL">
          <h3>Về DAFL</h3>
          <ul>
            <li><Link to="/" data-testid="footer-link-about">Giới thiệu</Link></li>
            <li><Link to="/" data-testid="footer-link-shops">Gian hàng</Link></li>
            <li><Link to="/" data-testid="footer-link-magazine">Tạp chí làm đẹp</Link></li>
            <li><Link to="/membership" data-testid="footer-link-member">DAFL Member</Link></li>
            <li><Link to="/" data-testid="footer-link-contact">Liên hệ</Link></li>
          </ul>
        </nav>
      </footer>

      <div className="footer-bottom">
        <span>© 2026 DAFL. Bảo lưu mọi quyền.</span>
        <span className="footer-payments">
          <CreditCard size={15} /> Thanh toán: PayOS · COD · Visa · Mastercard
        </span>
      </div>
    </div>
  );
};
