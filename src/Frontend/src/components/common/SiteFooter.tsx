import React, { useState } from 'react';
import { CheckCircle2, CreditCard, Mail, MapPin, Phone } from 'lucide-react';

export const SiteFooter: React.FC = () => {
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [newsletterError, setNewsletterError] = useState('');

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletterEmail.trim())) {
      setNewsletterError('Vui lòng nhập email đúng định dạng.');
      return;
    }
    setNewsletterError('');
    setNewsletterDone(true);
  };

  return (
    <div className="site-chrome">
      <section className="newsletter-band" aria-labelledby="newsletter-title">
        <div className="newsletter-copy">
          <h2 id="newsletter-title">Nhận ưu đãi DAFL mỗi tuần</h2>
          <p>Deal làm đẹp, mã giảm giá và sản phẩm mới được gửi thẳng tới hộp thư của bạn.</p>
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
              <button type="submit">Đăng ký</button>
            </div>
            {newsletterError && <span className="newsletter-error">{newsletterError}</span>}
          </form>
        )}
      </section>

      <footer className="site-footer">
        <div className="site-footer-brand">
          <div className="site-footer-logo">DAFL</div>
          <p>Mỹ phẩm chính hãng, được chọn lọc theo nhu cầu và loại da.</p>
          <p className="site-footer-contact">
            <Phone size={14} /> Hotline 1900 0000 (8h–21h)
          </p>
          <p className="site-footer-contact">
            <MapPin size={14} /> Hệ thống cửa hàng DAFL trên toàn quốc
          </p>
        </div>

        <nav aria-label="Mua sắm tại DAFL">
          <h3>Mua sắm</h3>
          <ul>
            <li>Chăm sóc da</li>
            <li>Trang điểm</li>
            <li>Chăm sóc tóc</li>
            <li>Cơ thể &amp; nước hoa</li>
            <li>Flash Sale DAFL</li>
          </ul>
        </nav>

        <nav aria-label="Hỗ trợ khách hàng DAFL">
          <h3>Hỗ trợ khách hàng</h3>
          <ul>
            <li>Hướng dẫn mua hàng</li>
            <li>Chính sách vận chuyển</li>
            <li>Đổi trả trong 30 ngày</li>
            <li>Tra cứu đơn hàng</li>
            <li>Câu hỏi thường gặp</li>
          </ul>
        </nav>

        <nav aria-label="Về DAFL">
          <h3>Về DAFL</h3>
          <ul>
            <li>Giới thiệu</li>
            <li>Hệ thống cửa hàng</li>
            <li>Tạp chí làm đẹp</li>
            <li>DAFL GLOW Member</li>
            <li>Liên hệ</li>
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
