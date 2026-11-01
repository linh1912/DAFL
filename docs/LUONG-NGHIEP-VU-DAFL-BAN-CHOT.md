# LUỒNG NGHIỆP VỤ DAFL — BẢN CHỐT (v5)

> **Phiên bản v5 — 2026-11-01.** Bản này **thay toàn bộ các bản trước** (v4, v3, v3.1 và các bản thiết kế AUTH/CART/PAY/GLOW). Nguồn sự thật của v5 là **đặc tả chuẩn CN-01..CN-08** do chủ đồ án cung cấp (`DAC-TA-CN-01-08.md`) cộng **3 override** do chính chủ đồ án chốt sau đó (Mục 0.2). Cấu trúc tài liệu tổ chức theo đúng 8 chức năng CN-01..CN-08; các phần nằm ngoài CN nhưng được giữ theo override (PayOS, voucher, social login) nằm ở Mục 11 — Phần mở rộng.
> Mục đích: (1) căn cứ sửa code FE/BE; (2) căn cứ viết/cập nhật test Selenium — mỗi chức năng có quy tắc, thông báo cố định và `data-testid` để assert; (3) đưa vào chương phân tích nghiệp vụ của đồ án.

## Lịch sử thay đổi

| Phiên bản | Nội dung |
|---|---|
| v1–v2 | Thiết kế AUTH/CART/PAY/GLOW; bản "cổng mềm" (guest checkout) — đã bị chủ đồ án bác bỏ. |
| v3 (bản chốt cũ) | Cổng đăng nhập ở bước thêm giỏ (GATE-01..06), đăng ký + xác thực OTP cứng, khóa mềm, quên mật khẩu OTP, GLOW dual price, trạng thái S0–S14. |
| v3.1 (hiệu chỉnh sau khi chạy thử) | Bỏ đăng nhập bằng OTP; bỏ nút "Dùng tài khoản Demo" khỏi giao diện auth; chuẩn validate inline đỏ dưới từng ô; checklist mật khẩu lưới 2×2; gửi OTP qua Gmail SMTP cấu hình bằng `.env`, dev hiển thị `debugCode`. |
| v4 | Thêm đăng nhập/đăng ký Google + Facebook (kèm mock cho môi trường test); form giao hàng cấu trúc Tỉnh/Quận/Phường + sổ địa chỉ + snapshot giao hàng trong đơn; trạng thái S0–S17. |
| **v5 (bản này)** | **Viết lại theo đặc tả CN-01..CN-08.** Bỏ: cổng đăng nhập ở bước thêm giỏ, xác thực OTP khi đăng ký, quên mật khẩu, khóa mềm tài khoản, yêu thích/đánh giá trên UI. Thay: phiên cookie `sid` 7 ngày → **JWT hạn 1 giờ**; giỏ chỉ-của-tài-khoản → **giỏ hai tầng (khách: localStorage; đăng nhập: server) + gộp giỏ khi đăng nhập**; trạng thái đơn kiểu thanh toán → **vòng đời đơn CN** (Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao / Đã hủy) kèm **hủy đơn + hoàn tồn kho**. Giữ theo override: **PayOS + COD**, **phí ship 25.000đ / miễn phí từ 299.000đ**, **voucher (làm kỹ — Mục 11.2)**, **social login Google/Facebook (Mục 11.1)**; **policy mật khẩu GIỮ NGUYÊN bản nghiêm ngặt của v3** — tối thiểu 8 ký tự + chữ hoa + chữ số + ký tự đặc biệt (O2 đã đính chính — KHÔNG áp dụng quy tắc nhẹ "chữ và số" của CN-01 gốc). |

---

## 0. Phạm vi, override và nguyên tắc chung

### 0.1 Phạm vi chuẩn

Tám chức năng phía khách hàng: **CN-01 Đăng ký · CN-02 Đăng nhập/Đăng xuất · CN-03 Quản lý thông tin cá nhân · CN-04 Xem danh sách, tìm kiếm, lọc sản phẩm · CN-05 Xem chi tiết sản phẩm · CN-06 Giỏ hàng · CN-07 Đặt hàng · CN-08 Xem và hủy đơn hàng.** Đây là phạm vi được chấm trong đồ án; mọi hành vi trong 8 mục CN-* của tài liệu này là **chuẩn bắt buộc**.

### 0.2 Ba override của chủ đồ án (quan trọng hơn CN gốc khi có xung đột)

| Mã | Nội dung override | Hệ quả cụ thể |
|---|---|---|
| **O1** | **Thanh toán / phí ship / voucher: GIỮ NGUYÊN như app hiện tại** | CN-07 giữ cả **COD + PayOS** (không rút xuống COD-only); phí ship **25.000đ**, miễn phí khi tạm tính **≥ 299.000đ** (KHÔNG đổi sang 30.000đ/500.000đ của CN gốc); **voucher/mã giảm giá giữ và làm kỹ** theo Mục 11.2 (BE kiểm tra lại khi đặt hàng, lỗi rõ từng trường hợp, đơn lưu mã + số tiền giảm, hiển thị tách dòng). |
| **O2** | **Quy tắc mật khẩu: GIỮ NGUYÊN policy nghiêm ngặt như bản v3** — tối thiểu 8 ký tự + ít nhất 1 chữ hoa + ít nhất 1 chữ số + ít nhất 1 ký tự đặc biệt (Daniel đính chính 2026-11-01) | Áp cho đăng ký (CN-01), đổi mật khẩu (CN-03.2) và đặt mật khẩu cho tài khoản social (Mục 11.1). Đây là **điểm Daniel giữ lại từ v3**: quy tắc nhẹ của CN-01 gốc ("tối thiểu 8 ký tự, gồm chữ và số") và câu thông báo lỗi mật khẩu đi kèm **KHÔNG áp dụng**; giữ checklist 4 điều kiện dạng lưới 2×2 xanh theo tiến độ gõ như hiện hành. |
| **O3** | **Social login Google/Facebook: GIỮ** | Thiết kế giữ nguyên như v4 (FE lấy token → BE verify trực tiếp với nhà cung cấp; mock ở Development/Testing cho Selenium; quy tắc liên kết L1–L5), rút gọn trình bày ở Mục 11.1. Tài khoản social được coi là đã xác thực email; sau khi có JWT thì mọi chức năng CN áp dụng như tài khoản thường. Đây là **phần mở rộng ngoài CN**, không thuộc 8 chức năng được chấm. |

### 0.3 Những gì v5 LOẠI BỎ (so với v4)

- Cổng đăng nhập ở bước thêm giỏ (GATE-01..06) và thông báo `auth-required-notice` — khách thêm giỏ tự do (CN-06).
- Xác thực OTP khi đăng ký và mọi trạng thái chờ xác thực (S2–S5 của v4) — đăng ký xong dùng được ngay (CN-01).
- Luồng quên mật khẩu (3 bước OTP/link đặt lại) — ngoài phạm vi CN. Hệ quả: không còn nhu cầu gửi email OTP → **SMTP/`debugCode` không còn bắt buộc** (xem Mục 15).
- Khóa mềm tài khoản, CAPTCHA theo số lần sai, cảnh báo "còn X lần thử" — đăng nhập sai chỉ trả một câu chung (CN-02-E1).
- Yêu thích (favorites) và đánh giá (reviews) trên giao diện: ẩn/gỡ khối yêu thích và khối đánh giá khỏi UI (chúng không nằm trong 8 chức năng CN). Dữ liệu đánh giá cũ trong DB giữ nguyên, chỉ không hiển thị/không cho thao tác.
- GLOW Member: không thuộc CN và không có override giữ — **đứng ngoài phạm vi v5**: giữ nguyên trạng thái code hiện tại, không mở rộng, không đưa vào bộ test chuẩn. (Nếu chủ đồ án muốn gỡ hẳn hoặc khôi phục vào phạm vi, cần quyết định riêng.)

### 0.4 Nguyên tắc chung

1. **Xem hàng và thêm giỏ không cần tài khoản.** Chỉ các trang/thao tác gắn với dữ liệu cá nhân mới cần đăng nhập: thanh toán (CN-07), đơn hàng (CN-08), hồ sơ (CN-03). Chặn ở đúng điểm đó theo CN-02-E4 (chuyển trang đăng nhập, xong quay lại đúng trang).
2. **Phiên đăng nhập = JWT hạn 1 giờ** (CN-02). FE lưu token, gửi kèm mọi request cần xác thực; hết hạn → về đăng nhập kèm thông báo cố định (CN-02-E3). Không còn cookie phiên `sid`.
3. **Giỏ hàng hai tầng, gộp khi đăng nhập** (CN-06.4): khách → localStorage; đã đăng nhập → server theo tài khoản; đăng nhập thành công thì gộp giỏ tạm vào giỏ tài khoản.
4. **Đơn hàng tự chứa đủ thông tin** (snapshot): giá tại thời điểm mua và bản sao địa chỉ giao hàng được lưu ngay trên đơn (CN-07) — sửa hồ sơ/sổ địa chỉ sau này không làm thay đổi đơn cũ.
5. **Chuẩn validate thống nhất toàn hệ** (kế thừa v3.1, áp cho mọi form):
   - **Không dùng popup validation mặc định của trình duyệt** (mọi form đặt `noValidate`).
   - Lỗi hiện bằng **chữ đỏ ngay dưới ô sai + viền ô đỏ**, mỗi ô một thông báo cố định theo bảng quy tắc của từng CN; FE validate trước, BE validate lại ở server.
   - Lỗi sai thông tin đăng nhập chỉ hiện **một chỗ duy nhất** (dưới ô Mật khẩu), một câu chung không lộ chi tiết (CN-02-E1).
   - Chuyển tab Đăng nhập ↔ Đăng ký thì **xóa sạch mọi lỗi** đang hiển thị.
   - Mọi ô text đều **trim khoảng trắng đầu/cuối** trước khi validate
...[truncated 29174 chars]
---

   - Card đăng nhập/đăng ký giữ bố cục 2 cột (trái: chỉ logo + tên DAFL), kích thước rộng rãi theo v3.1.
6. **Mọi trạng thái đều có `data-testid`** để Selenium assert; mọi cơ chế phục vụ kiểm thử (mock PayOS, mock social login) chỉ bật ở Development/Testing, phải ghi rõ trong báo cáo đồ án là cơ chế kiểm thử, **không bật ở production**.

---

## 1. Bảng tham số mặc định (mốc assert khi test)

| Tham số | Giá trị |
|---|---|
| Policy mật khẩu (đăng ký / đổi / đặt mật khẩu) | **Nghiêm ngặt như v3 (O2):** tối thiểu 8 ký tự + ≥ 1 chữ hoa + ≥ 1 chữ số + ≥ 1 ký tự đặc biệt · checklist lưới 2×2 xanh theo tiến độ gõ |
| Đăng ký | Không OTP, không chờ xác thực · email + SĐT đều duy nhất · đăng ký xong về form đăng nhập |
| Phiên đăng nhập | **JWT hạn 1 giờ** · FE lưu ở localStorage, gửi `Authorization: Bearer` · hết hạn → đăng nhập lại + "Phiên đăng nhập đã hết hạn" |
| Sổ địa chỉ | Tối đa **5** địa chỉ · địa chỉ đầu tiên tự là mặc định · đúng 1 mặc định tại một thời điểm |
| Danh sách sản phẩm | **12 sản phẩm/trang** · sắp xếp mặc định: mới nhất · giữ bộ lọc khi chuyển trang |
| Giỏ hàng | Khách: localStorage · đăng nhập: server theo tài khoản · gộp khi đăng nhập (cộng dồn, trần tồn kho) · trần số lượng mỗi dòng = tồn kho của biến thể |
| Phí vận chuyển (O1) | **25.000đ** · miễn phí khi tạm tính **≥ 299.000đ** |
| Ghi chú đơn hàng | Tùy chọn · tối đa **200 ký tự** |
| Mã đơn hàng | Dạng **DH{yyyyMMdd}-{số thứ tự 4 chữ số trong ngày}**, ví dụ DH20261101-0001 |
| Vòng đời đơn | Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao · nhánh: Chờ xác nhận → Đã hủy (hủy kèm hoàn tồn kho, idempotent) |
| Thanh toán (O1) | COD + PayOS · COD chỉ cho đơn ≤ 2.000.000đ (giữ như hiện tại) |
| Voucher (O1) | 1 mã/đơn · BE kiểm tra lại khi đặt hàng · đơn lưu mã + số tiền giảm (Mục 11.2) |
| Social login (O3) | Google/Facebook · mock chỉ Development/Testing · user mẫu `google.test@dafl.vn`, `facebook.test@dafl.vn` |

---

## CN-01. Đăng ký

| | |
|---|---|
| **Tác nhân** | Khách chưa có tài khoản |
| **Tiền điều kiện** | Chưa đăng nhập |
| **Hậu điều kiện** | Tài khoản mới được tạo với vai trò **customer**, mật khẩu đã mã hóa **bcrypt**, đăng nhập được ngay (không có bước xác thực OTP) |

**Luồng chính:**
1. Khách bấm **"Đăng ký"** trên header → hệ thống hiển thị form: họ tên, email, số điện thoại, mật khẩu, xác nhận mật khẩu. (Form đăng ký **không còn ô địa chỉ** như v3/v4 — địa chỉ giao hàng thuộc sổ địa chỉ CN-03.3 và checkout CN-07.)
2. Khách nhập thông tin và bấm "Đăng ký".
3. Hệ thống kiểm tra dữ liệu theo bảng quy tắc bên dưới (FE validate trước, BE validate lại).
4. Hệ thống kiểm tra **email chưa tồn tại** và **SĐT chưa tồn tại**.
5. Hệ thống mã hóa mật khẩu (bcrypt), lưu tài khoản với vai trò customer.
6. Hiển thị **"Đăng ký thành công"**, chuyển sang **trang/form đăng nhập** để khách đăng nhập ngay.

**Bảng quy tắc kiểm tra dữ liệu:**

| Trường | Quy tắc | Thông báo lỗi |
|---|---|---|
| Họ tên | Bắt buộc, 2–50 ký tự | "Họ tên không hợp lệ" |
| Email | Bắt buộc, đúng định dạng, **duy nhất** | "Email không hợp lệ" / "Email đã được sử dụng" |
| Số điện thoại | Bắt buộc, đúng 10 số bắt đầu bằng 0, **duy nhất** | "Số điện thoại không hợp lệ" / "Số điện thoại đã được sử dụng" |
| Mật khẩu | **Policy nghiêm ngặt (O2 — điểm Daniel giữ lại từ v3):** tối thiểu 8 ký tự + ít nhất 1 chữ hoa + ít nhất 1 chữ số + ít nhất 1 ký tự đặc biệt | Báo theo policy hiện hành: FE hiển thị **checklist 4 điều kiện dạng lưới 2×2** — điều kiện chưa đạt hiện ở ô mật khẩu, đạt điều kiện nào thì điều kiện đó **chuyển xanh** ngay khi gõ; BE trả thông báo lỗi tương ứng từng điều kiện. Câu lỗi nhẹ "Mật khẩu tối thiểu 8 ký tự, gồm chữ và số" của CN gốc **không áp dụng** |
| Xác nhận mật khẩu | Phải trùng mật khẩu | "Mật khẩu xác nhận không khớp" |

**Luồng ngoại lệ:**
- **E1:** Để trống trường bắt buộc → báo lỗi ngay tại ô đó, **không gửi form**.
- **E2:** Email hoặc SĐT trùng → báo lỗi tại đúng ô, **giữ nguyên dữ liệu đã nhập (trừ mật khẩu)**.
- **E3:** Lỗi server → báo **"Có lỗi xảy ra, vui lòng thử lại"**.

**Điểm cần test:** đăng ký hợp lệ (đăng nhập được ngay sau đó, không qua OTP); từng trường sai theo bảng quy tắc; mật khẩu thiếu từng điều kiện trong 4 điều kiện (thiếu chữ hoa / thiếu số / thiếu ký tự đặc biệt / dưới 8 ký tự) đều bị chặn và checklist phản ánh đúng; email trùng; SĐT trùng; xác nhận mật khẩu không khớp; **mật khẩu lưu trong DB là bcrypt, không phải bản rõ** (kiểm tra trực tiếp ở tầng dữ liệu/API).

`data-testid` (đã có trong FE): `register-form`, `register-name-input`, `register-email-input`, `register-phone-input`, `register-password-input`, `register-confirm-password-input`, `register-submit-btn`, các lỗi `register-name-error`, `register-email-error`, `register-phone-error`, `register-password-error`, `register-confirm-password-error`, checklist `password-rule-len`, `password-rule-upper`, `password-rule-digit`, `password-rule-special` (giữ nguyên theo policy nghiêm ngặt), nút hiện/ẩn `toggle-register-password-btn`, `toggle-register-confirm-password-btn`.
Cần bổ sung: `register-success-msg` (thông báo "Đăng ký thành công" — FE hiện chưa có testid riêng).
Bị gỡ theo v5: toàn bộ bước xác thực sau đăng ký (`register-verify-form`, `register-verify-btn`, `register-verify-resend`, `register-verify-error`, `register-verify-countdown`, `register-verify-debug-code`, `otp-*`) và ô địa chỉ trong form đăng ký (`register-address-input`, `register-address-error`).

---

## CN-02. Đăng nhập / Đăng xuất

| | |
|---|---|
| **Tác nhân** | Khách đã có tài khoản |
| **Tiền điều kiện** | Đã có tài khoản, chưa đăng nhập |
| **Hậu điều kiện** | Có **JWT hợp lệ (hạn 1 giờ)**; header hiển thị tên người dùng + menu tài khoản |

**Luồng chính — Đăng nhập:**
1. Khách bấm "Đăng nhập" (ở header, hoặc bị chuyển tới theo E4), nhập email và mật khẩu.
2. Hệ thống kiểm tra email có tồn tại và mật khẩu khớp với bản mã hóa bcrypt.
3. Hệ thống tạo **JWT (hạn 1 giờ)** trả về client. Client lưu token và gửi kèm mọi request cần xác thực (`Authorization: Bearer <token>`).
4. Client chuyển về **trang trước đó** (hoặc trang chủ nếu không có trang đích).
5. Header hiển thị **tên người dùng** và menu tài khoản (Hồ sơ, Đơn hàng của tôi, Đăng xuất).
6. Nếu đang có **giỏ hàng tạm** (khách chưa đăng nhập) → hệ thống **gộp vào giỏ của tài khoản** (CN-06.4) ngay sau khi đăng nhập thành công.
7. *(Mở rộng O3:)* đăng nhập bằng Google/Facebook theo Mục 11.1 cũng kết thúc ở bước 3–6 như trên.

**Luồng chính — Đăng xuất:**
1. Khách bấm "Đăng xuất" trong menu tài khoản.
2. Client **xóa token** (và mọi dữ liệu phiên phía client), chuyển về trang chủ, header trở lại trạng thái chưa đăng nhập. Giỏ tài khoản trên server không bị xóa (CN-06.4).

**Luồng ngoại lệ:**
- **E1:** Sai email hoặc mật khẩu → báo **"Email hoặc mật khẩu không đúng"** — một câu chung duy nhất, hiện **một chỗ duy nhất dưới ô Mật khẩu**, **không nêu rõ sai cái nào**, áp cho cả trường hợp email không tồn tại. *(Đổi câu chữ so với v4: "Email hoặc mật khẩu không chính xác." → câu của CN; test cũ assert câu cũ phải sửa.)*
- **E2:** Để trống trường → báo lỗi tại ô.
- **E3:** Token **hết hạn** khi đang thao tác → client xóa token, chuyển về trang đăng nhập kèm thông báo **"Phiên đăng nhập đã hết hạn"**.
- **E4:** Truy cập trang yêu cầu đăng nhập (thanh toán CN-07, đơn hàng CN-08, hồ sơ CN-03) khi chưa đăng nhập → chuyển đến trang đăng nhập; đăng nhập xong **quay lại đúng trang đó**.

**Điểm cần test:** đăng nhập đúng (header hiện tên, menu tài khoản có đủ mục); đăng nhập sai (đúng một câu E1, không lộ trường sai); để trống từng trường; truy cập trang cần đăng nhập khi chưa login → qua đăng nhập rồi quay lại đúng trang; đăng xuất rồi bấm **Back** không xem lại được trang riêng tư; token hết hạn (dùng token đã quá hạn 1 giờ hoặc token bị sửa) → bị đưa về đăng nhập kèm thông báo E3; đăng nhập xong giỏ tạm được gộp (chi tiết ở CN-06).

`data-testid`:
- Đã có: `login-form`, `login-email-input`, `login-password-input`, `login-submit-btn`, `login-email-error`, `login-password-error`, `toggle-login-password-btn`, tab `auth-tab-login` / `auth-tab-register`, `auth-modal`, `auth-close-btn`, `auth-error-msg`, header/menu: `account-toggle-btn`, `account-dropdown-menu`, `dropdown-profile-btn`, `dropdown-orders-btn`, `dropdown-logout-btn`, `dropdown-login-btn`; social: `social-google-btn`, `social-facebook-btn` (Mục 11.1).
- Cần bổ sung (chưa có trong FE): `session-expired-notice` (thông báo E3).
- Bị gỡ theo v5: `login-attempts-warning` (cảnh báo còn X lần thử — thuộc cơ chế khóa mềm), mọi testid quên mật khẩu `forgot-*`, và `auth-required-notice` (cổng thêm giỏ).

---

## CN-03. Quản lý thông tin cá nhân

| | |
|---|---|
| **Tác nhân** | Khách đã đăng nhập |
| **Tiền điều kiện** | Đã đăng nhập (JWT hợp lệ) |
| **Hậu điều kiện** | Hồ sơ/mật khẩu/sổ địa chỉ được cập nhật đúng quy tắc |

### CN-03.1 Xem và sửa hồ sơ

**Luồng chính:**
1. Khách vào "Tài khoản của tôi" (menu tài khoản → Hồ sơ). Hệ thống hiển thị họ tên, email, SĐT hiện tại.
2. Khách sửa **họ tên** và/hoặc **SĐT** (email hiển thị nhưng **không cho sửa** — ô disabled).
3. Bấm "Lưu" → hệ thống kiểm tra theo đúng quy tắc CN-01 (họ tên 2–50 ký tự; SĐT 10 số bắt đầu bằng 0) và kiểm tra SĐT **không trùng tài khoản khác**.
4. Hợp lệ → cập nhật, hiện "Cập nhật thành công". Tên trên header cập nhật theo họ tên mới.

**Ngoại lệ:** SĐT trùng tài khoản khác → "Số điện thoại đã được sử dụng" dưới ô SĐT, không lưu. Trường sai định dạng → thông báo tương ứng của CN-01 dưới đúng ô.

### CN-03.2 Đổi mật khẩu

**Luồng chính:**
1. Tại mục "Đổi mật khẩu" trong trang Hồ sơ, khách nhập: mật khẩu hiện tại, mật khẩu mới, xác nhận mật khẩu mới.
2. Hệ thống kiểm tra lần lượt: mật khẩu hiện tại đúng → mật khẩu mới đạt quy tắc O2 → mật khẩu mới **khác** mật khẩu cũ → xác nhận trùng khớp.
3. Đạt cả ba → cập nhật mật khẩu (bcrypt), hiện "Cập nhật thành công", **xóa trắng cả 3 ô**. Phiên hiện tại giữ nguyên (không bắt đăng nhập lại); các thiết bị khác đăng nhập bằng mật khẩu cũ vẫn dùng được token đã cấp cho tới khi hết hạn 1 giờ (đặc tính JWT — ghi rõ trong báo cáo).

| Trường hợp | Thông báo |
|---|---|
| Mật khẩu hiện tại sai | "Mật khẩu hiện tại không đúng" (dưới ô mật khẩu hiện tại) |
| Mật khẩu mới không đạt policy nghiêm ngặt (O2) | Báo theo từng điều kiện chưa đạt của checklist 4 điều kiện (như CN-01); KHÔNG dùng câu lỗi nhẹ của CN gốc |
| Mật khẩu mới trùng mật khẩu cũ | "Mật khẩu mới không được trùng với mật khẩu cũ" |
| Xác nhận không khớp | "Mật khẩu xác nhận không khớp" |

### CN-03.3 Sổ địa chỉ giao hàng

**Luồng chính:**
1. Tại mục "Sổ địa chỉ" trong trang Hồ sơ, khách xem danh sách địa chỉ đã lưu (mỗi thẻ: nhãn "Mặc định" nếu là mặc định, người nhận, SĐT, địa chỉ đầy đủ đã ghép).
2. **Thêm địa chỉ:** mở form gồm tên người nhận, SĐT người nhận, Tỉnh/Thành phố, Quận/Huyện, Phường/Xã (3 select nối cấp từ dữ liệu tĩnh `vietnam-provinces.json` — giữ nguyên mô hình dữ liệu địa giới đã làm ở v4, dùng chung với form giao hàng ở CN-07), địa chỉ cụ thể. Validate như CN-01 (tên 2–50, SĐT VN) và địa chỉ cụ thể ≥ 5 ký tự sau trim.
3. **Sửa:** mở form nạp sẵn dữ liệu, lưu lại sau validate. **Xóa:** hỏi xác nhận rồi xóa. **Đặt mặc định:** bấm "Đặt làm mặc định" trên một thẻ → thẻ đó thành mặc định, thẻ mặc định cũ mất nhãn.
4. Đơn hàng luôn lưu **bản sao** địa chỉ (CN-07) nên sửa/xóa ở đây không ảnh hưởng đơn đã đặt.

**Quy tắc:**
- Tối đa **5 địa chỉ**/tài khoản; thêm địa chỉ thứ 6 → chặn + "Bạn đã lưu tối đa 5 địa chỉ. Vui lòng xóa bớt trước khi thêm mới."
- Địa chỉ **đầu tiên** tự động là mặc định.
- Đúng **1 địa chỉ mặc định** tại một thời điểm. Xóa địa chỉ mặc định → địa chỉ **còn lại gần nhất** (mới nhất còn lại) tự lên làm mặc định.
- Không áp quy tắc "không xóa được địa chỉ đang gắn với đơn chưa hoàn tất" — vì đơn lưu bản sao (cách CN khuyến nghị), địa chỉ trong sổ xóa tự do.

**Điểm cần test (CN-03):** sửa hồ sơ hợp lệ/không hợp lệ; SĐT trùng tài khoản khác bị chặn; email không sửa được; đổi mật khẩu sai mật khẩu hiện tại; mật khẩu mới trùng cũ bị chặn; đổi xong đăng xuất và đăng nhập lại bằng mật khẩu mới thành công, mật khẩu cũ bị từ chối; thêm địa chỉ thứ 6 bị chặn; địa chỉ đầu tiên tự là mặc định; đặt mặc định thủ công; xóa mặc định thì địa chỉ gần nhất lên thay; luôn đúng 1 mặc định.

`data-testid`:
- Đã có: `set-password-form`, `set-password-input`, `set-password-confirm-input`, `set-password-submit-btn`, `set-password-error`, `set-password-success` — **chỉ dành cho đặt mật khẩu lần đầu của tài khoản social (Mục 11.1), không phải form đổi mật khẩu**.
- Cần bổ sung (chưa có trong FE): `profile-name-input`, `profile-phone-input`, `profile-email-input`, `profile-save-btn`, `profile-success-msg`, `profile-name-error`, `profile-phone-error`; `change-password-current-input`, `change-password-new-input`, `change-password-confirm-input`, `change-password-submit-btn`, `change-password-current-error`, `change-password-new-error`, `change-password-confirm-
...[truncated 31971 chars]
---

## CN-04. Xem danh sách, tìm kiếm, lọc sản phẩm

| | |
|---|---|
| **Tác nhân** | Khách (không cần đăng nhập) |
| **Tiền điều kiện** | Không |
| **Hậu điều kiện** | Danh sách hiển thị đúng điều kiện tìm/lọc/sắp xếp, phân trang đúng |

**Luồng chính:**
1. Khách vào trang chủ hoặc trang "Sản phẩm" → hệ thống hiển thị các sản phẩm **đang bán**, có **phân trang 12 sản phẩm/trang**.
2. Mỗi thẻ sản phẩm gồm: ảnh, tên, giá (giá khuyến mãi nếu có), nhãn **"Hết hàng"** nếu tồn kho = 0.
3. Khách có thể **kết hợp đồng thời** các điều kiện:
   - **Tìm kiếm** theo từ khóa trong tên sản phẩm (không phân biệt hoa thường).
   - **Lọc theo danh mục.**
   - **Lọc theo khoảng giá** (từ – đến).
   - **Sắp xếp:** mới nhất (mặc định), giá tăng dần, giá giảm dần.
4. Hệ thống trả kết quả theo đúng điều kiện kết hợp; **giữ nguyên bộ lọc khi chuyển trang** (điều kiện lọc/tìm/sắp xếp được giữ trong trạng thái trang/URL khi phân trang).

**Luồng ngoại lệ:**
- **E1:** Không có kết quả → hiển thị **"Không tìm thấy sản phẩm phù hợp"** kèm nút **"Xóa bộ lọc"** (bấm nút → xóa toàn bộ điều kiện, về danh sách đầy đủ).
- **E2:** Khoảng giá "từ" lớn hơn "đến" → báo lỗi tại bộ lọc, **không thực hiện lọc**.
- **E3:** Từ khóa chứa ký tự đặc biệt/mã độc (ví dụ `' OR 1=1 --`) → xử lý như chuỗi thường, không gây lỗi, không trả dữ liệu sai (chống SQL Injection/XSS — BE dùng truy vấn tham số hóa, FE không render HTML thô từ từ khóa).

**Quy tắc:** sản phẩm **ngừng bán không hiển thị**; sản phẩm **hết hàng vẫn hiển thị** (kèm nhãn) nhưng **không cho thêm vào giỏ** (nút thêm bị khóa ở thẻ và ở trang chi tiết).

**Điểm cần test:** phân trang (đúng 12 sản phẩm/trang, trang cuối đúng số dư, giữ bộ lọc khi chuyển trang); tìm có kết quả / không có kết quả (E1 + nút xóa bộ lọc hoạt động); lọc từng điều kiện riêng lẻ và **kết hợp nhiều điều kiện**; sắp xếp đúng thứ tự cả 3 kiểu; khoảng giá từ > đến → E2; chuỗi `' OR 1=1 --` không làm hỏng hệ thống và không trả toàn bộ sản phẩm như một kết quả "đúng"; sản phẩm ngừng bán không xuất hiện; sản phẩm hết hàng hiện nhãn và không thêm giỏ được.

`data-testid`:
- Đã có: `search-bar`, `search-input`, `search-clear-btn`, `categories-bar`, `category-pill-all`, `category-pill-{id}`, `category-filter-section`, `clear-category-btn`, `category-empty-state`, thẻ sản phẩm: `product-card-{id}`, `product-name-{id}`, `product-price-{id}`, `product-stock-{id}` (chứa chữ "Hết hàng" khi hết hàng), `add-to-cart-btn-{id}`.
- Cần bổ sung (chưa có trong FE — hiện chưa gắn testid cho phân trang, sắp xếp và khoảng giá): `catalog-pagination`, `pagination-prev-btn`, `pagination-next-btn`, `pagination-page-{n}`, `sort-select`, `price-from-input`, `price-to-input`, `price-filter-error`, `catalog-result-count`. Ô trạng thái rỗng hiện dùng `category-empty-state` — dùng thống nhất testid này cho E1, bổ sung `clear-filters-btn` cho nút "Xóa bộ lọc".

---

## CN-05. Xem chi tiết sản phẩm

| | |
|---|---|
| **Tác nhân** | Khách (không cần đăng nhập) |
| **Tiền điều kiện** | Sản phẩm đang bán |
| **Hậu điều kiện** | Khách xem đủ thông tin để quyết định mua; có thể chuyển sang CN-06 (Thêm vào giỏ) hoặc CN-07 (Mua ngay) |

**Luồng chính:**
1. Khách bấm vào một sản phẩm (từ danh sách CN-04, tìm kiếm, hoặc link trực tiếp).
2. Hệ thống hiển thị: bộ ảnh (gallery nhiều ảnh), tên, mã sản phẩm, giá gốc/giá khuyến mãi, mô tả, tồn kho, các biến thể (dung tích/tông màu nếu sản phẩm có biến thể). *(Khối đánh giá/điểm sao thuộc phạm vi bị loại bỏ ở v5 — ẩn khỏi trang chi tiết.)*
3. Khách chọn biến thể (nếu có) và chọn số lượng — mặc định **1**.
4. Bấm **"Thêm vào giỏ"** → đi luồng CN-06.1 (khách hay thành viên đều thêm được). Bấm **"Mua ngay"** → thêm vào giỏ rồi chuyển thẳng sang bước thanh toán CN-07 (chưa đăng nhập thì CN-07/CN-02-E4 đưa qua đăng nhập và quay lại).

**Bảng quy tắc:**

| Đối tượng | Quy tắc |
|---|---|
| Số lượng | Số nguyên, **1 ≤ số lượng ≤ tồn kho của biến thể** đã chọn |
| Biến thể hết hàng | Bị làm mờ (disabled), không chọn được |
| Nút mua (Thêm vào giỏ / Mua ngay) | Bị khóa khi sản phẩm (hoặc biến thể đã chọn) hết hàng |

**Luồng ngoại lệ:**
- **E1:** Sản phẩm không tồn tại hoặc đã ngừng bán (truy cập bằng link cũ) → trang **"404 - Không tìm thấy sản phẩm"**.
- **E2:** Nhập số lượng ≤ 0, nhập chữ, hoặc vượt tồn kho → báo lỗi, tự đưa về giá trị hợp lệ gần nhất (1 hoặc mức tồn kho).

**Điểm cần test:** hiển thị đúng thông tin (giá, giá khuyến mãi, tồn kho); số lượng biên: 0, 1, bằng tồn kho, tồn kho + 1; sản phẩm hết hàng (nút mua khóa, biến thể hết hàng không chọn được); link sản phẩm không tồn tại → 404 đúng câu.

`data-testid`:
- Đã có: `product-detail-page`, `product-detail-back-btn`, `product-gallery`, `product-gallery-main`, `product-gallery-prev`, `product-gallery-next`, `product-gallery-counter`, `product-gallery-thumb-{i}`.
- Cần bổ sung (chưa có trong FE — nút số lượng ở chi tiết hiện là class `qty-btn`, nút Mua ngay và ô chọn biến thể chưa gắn testid): `detail-qty-minus`, `detail-qty-plus`, `detail-qty-value`, `detail-add-to-cart-btn`, `buy-now-btn`, `variant-option-{variantId}`, `detail-out-of-stock-notice`, `product-not-found-page`.

---

## CN-06. Giỏ hàng

| | |
|---|---|
| **Tác nhân** | Khách (chưa hoặc đã đăng nhập) |
| **Tiền điều kiện** | Không |
| **Hậu điều kiện** | Giỏ phản ánh đúng sản phẩm/số lượng/giá hiện tại; sẵn sàng chuyển sang CN-07 |

### CN-06.1 Thêm vào giỏ

**Luồng chính:**
1. Khách bấm "Thêm vào giỏ" ở trang chi tiết (CN-05, kèm biến thể + số lượng đã chọn) hoặc ở thẻ sản phẩm (dùng biến thể mặc định, số lượng 1). **Không có cổng đăng nhập ở bước này.**
2. Hệ thống kiểm tra tồn kho của biến thể.
3. Nếu sản phẩm **cùng biến thể** đã có trong giỏ → **cộng dồn** số lượng; chưa có → thêm dòng mới.
4. Cập nhật số lượng trên biểu tượng giỏ (badge), hiện thông báo **"Đã thêm vào giỏ hàng"**.

**Ngoại lệ:** tổng số lượng sau cộng dồn vượt tồn kho → chỉ thêm đến mức tối đa có thể, báo **"Chỉ còn X sản phẩm"**. Sản phẩm hết hàng: nút thêm bị khóa ngay từ thẻ/chi tiết (CN-04/CN-05) nên không tới được bước này.

### CN-06.2 Xem giỏ hàng

- Mỗi dòng gồm: ảnh, tên, biến thể, đơn giá, số lượng, thành tiền (= đơn giá × số lượng).
- Cuối giỏ có **tạm tính** (tổng các thành tiền) và nút **"Thanh toán"**.
- Giỏ trống → hiển thị **"Giỏ hàng trống"** kèm nút "Tiếp tục mua sắm", **ẩn nút thanh toán**.

### CN-06.3 Sửa số lượng / xóa

- Bấm **+/−** hoặc nhập số trực tiếp: hệ thống kiểm tra tồn kho, tính lại thành tiền và tạm tính **ngay**.
- Số lượng vượt tồn kho → đặt về mức tối đa và báo **"Chỉ còn X sản phẩm"**.
- Giảm về **0** hoặc bấm **"Xóa"**: hệ thống **hỏi xác nhận**, khách đồng ý mới xóa dòng đó. *(Thay đổi so với v4: trước đây giảm về 0 là xóa ngay không hỏi.)*

### CN-06.4 Lưu giỏ và gộp giỏ

| Trạng thái | Nơi lưu giỏ |
|---|---|
| Chưa đăng nhập | **localStorage** của trình duyệt (`dafl_guest_cart`) |
| Đã đăng nhập | **Server, theo tài khoản** (API giỏ hàng) — giữ lại khi đăng xuất và đăng nhập lại, dùng được ở thiết bị khác |

- **Gộp giỏ khi đăng nhập:** ngay sau khi đăng nhập thành công (CN-02, mọi kênh kể cả social), hệ thống gộp giỏ tạm vào giỏ tài khoản: sản phẩm trùng biến thể → cộng dồn số lượng (**không vượt tồn kho** — phần vượt bị cắt và thông báo); sản phẩm chỉ có ở một phía → giữ nguyên. Gộp xong **xóa giỏ tạm** ở localStorage. Thông báo tóm tắt khi có cắt giảm do tồn kho.
- Đăng xuất **không** xóa giỏ tài khoản; giỏ tạm của phiên khách mới bắt đầu rỗng.

### CN-06.5 Đồng bộ giá / tồn kho

- **Mỗi lần mở giỏ**, hệ thống lấy lại giá và tồn kho mới nhất của từng dòng.
- Giá thay đổi → cập nhật theo giá mới và **thông báo** cho khách (dòng đó được đánh dấu "Giá vừa thay đổi").
- Sản phẩm bị ngừng bán hoặc hết hàng → **đánh dấu dòng**, **không cho thanh toán dòng đó** (loại khỏi tạm tính thanh toán và chặn ở CN-07 bước kiểm tra), khách có thể tự xóa dòng.

**Điểm cần test:** thêm mới; cộng dồn cùng biến thể; cộng dồn chạm trần tồn kho (báo "Chỉ còn X sản phẩm"); sửa số lượng biên (0 → hỏi xác nhận xóa; tồn kho + 1 → về tối đa); xóa có xác nhận và hủy xác nhận thì giữ nguyên; tính tổng đúng (kể cả số lẻ); giỏ khách lưu localStorage (F5 còn giỏ); **gộp giỏ sau đăng nhập** (trùng → cộng dồn, không vượt tồn); giỏ tài khoản giữ nguyên sau đăng xuất → đăng nhập lại; mở giỏ thấy giá mới khi giá đã đổi.

`data-testid`:
- Đã có: `cart-btn`, `cart-badge-count`, `cart-drawer`, `cart-close-btn`, `cart-items-list`, `cart-item-{productId}`, `cart-item-name-{productId}`, `cart-item-price-{productId}`, `cart-item-qty-{productId}`, `cart-item-plus-{productId}`, `cart-item-minus-{productId}`, `cart-pricing-summary`, `cart-raw-subtotal`, `cart-voucher-discount`, `cart-final-total`, `cart-empty-state`, khối voucher `voucher-section`, `voucher-code-input`, `voucher-apply-btn`, `voucher-error-msg`, `voucher-chips`, `voucher-chip-{code}`, `remove-voucher-btn` (voucher áp tại giỏ — chi tiết Mục 11.2).
- Cần bổ sung (chưa có trong FE): `cart-checkout-btn` (nút Thanh toán trong giỏ — hiện chưa gắn testid riêng), `cart-added-toast` (thông báo "Đã thêm vào giỏ hàng"), `cart-remove-confirm-dialog`, `cart-remove-confirm-btn`, `cart-remove-cancel-btn`, `cart-item-unavailable-{productId}` (dòng ngừng bán/hết hàng bị đánh dấu), `cart-item-price-changed-{productId}`.

---

## CN-07. Đặt hàng

| | |
|---|---|
| **Tác nhân** | Khách đã đăng nhập |
| **Tiền điều kiện** | Đã đăng nhập; giỏ có ít nhất 1 sản phẩm hợp lệ; đã có ít nhất 1 địa chỉ giao hàng trong sổ (CN-03.3) |
| **Hậu điều kiện** | Đơn hàng được tạo (trạng thái Chờ xác nhận), tồn kho giảm đúng, các sản phẩm đã đặt bị xóa khỏi giỏ |

**Luồng chính:**
1. Khách bấm "Thanh toán" ở giỏ hàng. Chưa đăng nhập → chuyển đến trang đăng nhập trước (CN-02-E4), đăng nhập xong quay lại đúng bước thanh toán (giỏ đã gộp theo CN-06.4).
2. Hệ thống **kiểm tra lại từng sản phẩm** trong giỏ: còn đang bán, đủ tồn kho, giá hiện tại.
3. Trang thanh toán hiển thị:
   - **Địa chỉ giao hàng:** địa chỉ mặc định được chọn sẵn; khách đổi sang địa chỉ khác trong sổ hoặc **thêm mới** ngay tại checkout (form `shipping-*` như CN-03.3; thêm mới ở đây cũng tuân trần 5 địa chỉ và được lưu vào sổ).
   - **Danh sách sản phẩm** sẽ mua (tên, biến thể, số lượng, đơn giá, thành tiền).
   - **Phương thức thanh toán:** COD và PayOS (theo O1 — xem Mục 11.3; gồm điều kiện COD cho đơn ≤ 2.000.000đ như hiện tại).
   - **Mã giảm giá** (nếu chưa áp ở giỏ): nhập/áp tại khối voucher — BE kiểm tra lại toàn bộ ở bước đặt hàng (Mục 11.2).
   - **Ghi chú cho đơn hàng** (tùy chọn, **tối đa 200 ký tự**).
4. Hệ thống tính tiền và hiển thị tách dòng:
   - Tạm tính = Σ (đơn giá × số lượng)
   - Giảm giá voucher (dòng riêng, nếu có)
   - Phí vận chuyển theo **O1: cố định 25.000đ; miễn phí nếu tạm tính ≥ 299.000đ** *(không dùng 30.000đ/500.000đ của CN gốc)*
   - **Tổng thanh toán = Tạm tính − Giảm giá + Phí vận chuyển**
5. Khách kiểm tra và bấm **"Đặt hàng"**.
6. Hệ thống thực hiện **trong một transaction**:
   a. Kiểm tra tồn kho lần cuối cho mọi dòng.
   b. Tạo đơn hàng với **mã duy nhất dạng `DH20261101-0001`** (ngày đặt + số thứ tự 4 chữ số trong ngày) và chi tiết đơn — **lưu giá tại thời điểm mua** và **bản sao địa chỉ giao hàng** (snapshot: người nhận, SĐT, Tỉnh/Quận/Phường dạng tên + địa chỉ cụ thể), kèm mã voucher + số tiền giảm (nếu có).
   c. Trừ tồn kho.
   d. Xóa các sản phẩm đã đặt khỏi giỏ (giỏ server của tài khoản).
   e. Đặt trạng thái **Chờ xác nhận**; ghi mốc đầu tiên vào lịch sử trạng thái.
7. Hiển thị trang **"Đặt hàng thành công"** gồm: mã đơn, tổng tiền, địa chỉ giao hàng, nút "Xem đơn hàng" và "Tiếp tục mua sắm". (Nếu chọn PayOS: sau khi tạo đơn, đi tiếp luồng thanh toán Mục 11.3 rồi mới tới trạng thái đã thanh toán; vòng đời giao hàng vẫn bắt đầu ở Chờ xác nhận.)

**Luồng ngoại lệ:**
- **E1:** Có sản phẩm hết hàng/không đủ số lượng ở bước 2 hoặc bước 6 → **không tạo đơn, rollback toàn bộ**, báo rõ sản phẩm nào, đưa khách về giỏ để chỉnh.
- **E2:** Giá thay đổi so với lúc thêm vào giỏ → hiển thị giá mới và yêu cầu khách **xác nhận lại** mới cho đặt.
- **E3:** Chưa có địa chỉ giao hàng nào → yêu cầu thêm địa chỉ, **không cho đặt**.
- **E4:** Hai khách cùng mua sản phẩm cuối cùng → transaction + kiểm tra tồn kho nguyên tử đảm bảo **một người thành công**, người còn lại nhận E1.
- **E5:** Bấm "Đặt hàng" nhiều lần liên tiếp (double click) → **chỉ tạo một đơn** (khóa nút ngay khi bấm + mã chống trùng/idempotency key ở BE).
- **E6:** Lỗi hệ thống giữa chừng → rollback: không mất giỏ, không trừ tồn kho, không tạo đơn dở.

**Điểm cần test:** đặt thành công (tồn kho giảm đúng, giỏ trống các dòng đã đặt, đơn ở trạng thái Chờ xác nhận, mã đơn đúng định dạng `DHyyyyMMdd-NNNN`); tính tiền và phí ship ở các mốc tạm tính 298.999 / 299.000 (theo O1); hết hàng tại thời điểm đặt → E1; double click → 1 đơn; đặt khi chưa đăng nhập → đi qua đăng nhập rồi đặt được; giá lưu trong chi tiết đơn **không đổi** khi giá sản phẩm thay đổi sau đó; địa chỉ trong đơn không đổi khi sổ địa chỉ bị sửa; chưa có địa chỉ → E3.

`data-testid`:
- Đã có: `checkout-form`, `checkout-submit-btn`, `checkout-order-code`, `checkout-payment-view`, `order-paid-view`, `order-expired-view`, `payment-page`, `payment-total-amount`, `payment-timer`, khối giao hàng đầy đủ: `shipping-address-list`, `shipping-address-option-{id}`, `shipping-new-address-btn`, `shipping-new-address-form`, `shipping-recipient-input`, `shipping-phone-input`, `shipping-email-input`, `shipping-province-select`, `shipping-district-select`, `shipping-ward-select`, `shipping-detail-input`, `shipping-note-input`, `shipping-save-default-checkbox` và các `shipping-*-error` tương ứng; trang thành công: `continue-shopping-btn`, `view-orders-btn`, `copy-order-code-btn`; khối voucher như CN-06.
- Cần điều chỉnh/bổ sung: `shipping-note-input` hiện là ghi chú giao hàng giới hạn 500 ký tự ở v4 → v5 dùng làm **ghi chú đơn hàng, đổi giới hạn thành 200 ký tự** (+ `shipping-note-error` khi vượt); bổ sung `order-success-view` (trang "Đặt hàng thành công" — hiện các nút/mã đơn đã có testid rời, chưa có testid cho cả trang), `checkout-price-changed-notice` (thông báo E2). `checkout-auth-required-notice` (cổng ở checkout của v4) **bị gỡ** — thay bằng chuyển hướng đăng nhập theo CN-02-E4.

---

## CN-08. Xem và hủy đơn hàng

| | |
|---|---|
| **Tác nhân** | Khách đã đăng nhập |
| **Tiền điều kiện** | Đã đăng nhập (JWT hợp lệ) |
| **Hậu điều kiện** | Khách xem được đơn của chính mình; đơn hủy hợp lệ chuyển sang Đã hủy và tồn kho được hoàn đúng một lần |

### CN-08.1 Xem danh sách đơn

- Khách vào "Đơn hàng của tôi": hệ thống liệt kê **đơn của chính khách đó**, **mới nhất trước**, **có phân trang**.
- Mỗi dòng gồm: mã đơn, ngày đặt, tổng tiền, trạng thái.
- Có thể **lọc theo trạng thái**.
- Chưa có đơn → hiển thị **"Bạn chưa có đơn hàng nào"** kèm nút mua sắm.

### CN-08.2 Xem chi tiết đơn

- Khách bấm vào một đơn để xem: mã đơn, ngày đặt, trạng thái, danh sách sản phẩm (ảnh, tên, biến thể, giá, số lượng), **địa chỉ nhận** (bản sao đã lưu ở CN-07), phương thức thanh toán, phí ship, tổng tiền, **lịch sử các mốc trạng thái**.
- Truy cập mã đơn **của người khác** (sửa URL/ID) → trả lỗi **"Không có quyền truy cập"** hoặc 404. BE kiểm tra quyền sở hữu ở mọi API chi tiết/hủy đơn, không chỉ ẩn ở FE.

### Vòng đời trạng thái (rút gọn — chuẩn CN)

```
Chờ xác nhận ──► Đang chuẩn bị ──► Đang giao ──► Đã giao
      │
      └────────► Đã hủy
```

- Việc chuyển trạng thái từ "Đang chuẩn bị" trở đi **do admin thực hiện** (phía admin không thuộc phạm vi đồ án này). Vì chỉ làm phía khách hàng, các trạng thái sau được tạo bằng **dữ liệu mẫu hoặc API giả lập** để phục vụ test.
- Trạng thái vòng đời là trường riêng với **trạng thái thanh toán** (Chưa thanh toán / Đã thanh toán — cho PayOS): một đơn PayOS đã thanh toán vẫn bắt đầu vòng đời ở Chờ xác nhận. *(Thay đổi so với v4: bỏ mô hình trạng thái kiểu thanh toán `Pending → Paid / Cancelled / Expired` làm trạng thái chính của đơn.)*

### CN-08.3 Hủy đơn

**Luồng chính:**
1. Khách bấm **"Hủy đơn"** tại trang chi tiết đơn.
2. Hệ thống hiển thị **hộp thoại**: khách **chọn lý do** (danh sách có sẵn) hoặc **nhập lý do khác**, rồi bấm xác nhận.
3. Hệ thống kiểm tra: đơn **thuộc về khách này** và đang ở trạng thái **Chờ xác nhận**.
4. Trong **một transaction**: đổi trạng thái → **Đã hủy**, lưu **lý do** và **thời điểm hủy**, **hoàn lại tồn kho** theo từng dòng sản phẩm, ghi mốc vào lịch sử trạng thái.
5. Thông báo **"Hủy đơn thành công"**; chi tiết đơn tải lại với trạng thái Đã hủy.

**Quy tắc:** chỉ hủy được khi đơn ở **Chờ xác nhận**. Từ Đang chuẩn bị trở đi: **ẩn hoặc khóa** nút hủy và hiện **"Vui lòng liên hệ hỗ trợ"**.

**Luồng ngoại lệ:**
- **E1:** Đơn đã đổi trạng thái giữa lúc khách mở trang và bấm hủy → từ chối, báo **"Đơn không còn có thể hủy"** và tải lại trạng thái mới.
- **E2:** Hủy đơn đã hủy → **không thực hiện lại, không hoàn tồn kho lần hai** (hủy là thao tác idempotent — kiểm tra trạng thái ngay trong transaction).
- **E3:** Hủy đơn của người khác (gọi API trực tiếp) → từ chối quyền ("Không có quyền truy cập").

**Điểm cần test:** xem đúng đơn của mình, không xem được đơn người khác (kể cả sửa URL); hủy ở Chờ xác nhận thành công (trạng thái Đã hủy, lý do được lưu, **tồn kho tăng lại đúng** số lượng từng dòng); không hủy được ở Đang chuẩn bị/Đang giao/Đã giao (nút ẩn/khóa + câu hỗ trợ); hủy hai lần liên tiếp → tồn kho chỉ hoàn một lần; hủy đơn người khác qua API → bị từ chối; lọc theo trạng thái đúng; phân trang danh sách đơn.

`data-testid`:
- Đã có: `order-shipping-info` (khối địa chỉ nhận trong đơn), `dropdown-orders-btn`, `view-orders-btn`.
- Cần bổ sung (chưa có trong FE — danh sách đơn hiện render bằng class `order-card`, chưa có testid cho từng đơn/chi tiết/hủy): `orders-list`, `order-item-{orderCode}`, `order-status-filter`, `orders-pagination`, `orders-empty-state`, `order-detail-view`, `order-detail-status`, `order-timeline`, `cancel-order-btn`, `cancel-order-dialog`, `cancel-reason-select`, `cancel-reason-input`, `cancel-confirm-btn`, `cancel-cancel-btn`, `cancel-success-msg`, `order-support-note` (câu "Vui lòng liên hệ hỗ trợ").

---

---

## 11. Phần mở rộng ngoài CN (giữ theo override)

### 11.1 Social login Google / Facebook *(giữ theo O3 — thiết kế của v4, rút gọn)*

1. **Mô hình:** FE lấy token từ nhà cung cấp → BE **xác thực token trực tiếp với nhà cung cấp** → BE cấp **JWT 1 giờ** như đăng nhập thường (v5: hội tụ về JWT của CN-02 thay cho cookie `sid` của v4). DAFL không lưu token của Google/Facebook sau khi xác thực.
   - **Google:** FE dùng Google Identity Services (GIS) → nhận `id_token` → `POST /api/auth/social/google { idToken }`. BE kiểm chữ ký JWT qua chứng chỉ Google, `iss`, **`aud` = `GOOGLE_CLIENT_ID`**, hạn dùng, `email_verified = true` (dùng thư viện `Google.Apis.Auth`).
   - **Facebook:** FE dùng Facebook JS SDK (`FB.login`, scope `email,public_profile`) → nhận `access_token` → `POST /api/auth/social/facebook { accessToken }`. BE gọi Graph API `debug_token` (kiểm `is_valid`, đúng `app_id`, còn hạn) rồi `/me?fields=id,name,email,picture`.
2. **Không tin dữ liệu FE tự khai:** họ tên/email chỉ lấy từ token đã xác thực phía BE.
3. **Quy tắc tìm/tạo/liên kết** (bảng `UserExternalIdentity`, unique `(Provider, ProviderUserId)`):
   - **L1:** đã có định danh → đăng nhập đúng tài khoản đó.
   - **L2:** chưa có định danh nhưng email từ nhà cung cấp **trùng** tài khoản sẵn có **và đã được nhà cung cấp xác thực** → **tự động liên kết** rồi đăng nhập (chỉ liên kết khi email đã được nhà cung cấp xác thực — điều kiện bắt buộc chống chiếm tài khoản; không liên kết theo họ tên/SĐT).
   - **L3:** email không trùng → **tự tạo tài khoản**: `EmailVerified = true` ngay (không OTP — email đã được nhà cung cấp xác thực), `PasswordHash = null`.
   - **L4:** nhà cung cấp **không trả email** (Facebook) → không tạo tài khoản không email; yêu cầu khách nhập email và xác thực email đó bằng mã gửi về email trước khi tạo/liên kết. *(Đây là lần duy nhất v5 còn dùng mã xác thực email — chỉ trong nhánh phụ của social, không thuộc CN-01.)*
   - **L5:** đang đăng nhập mà liên kết thêm provider → gắn vào tài khoản hiện tại; định danh đã thuộc tài khoản khác → lỗi "Tài khoản {Google/Facebook} này đã được liên kết với một tài khoản DAFL khác."
4. **Tài khoản social sau khi tạo:** đăng nhập các lần sau qua L1; muốn đăng nhập bằng mật khẩu → vào Hồ sơ dùng mục **"Đặt mật khẩu"** (chỉ hiện khi chưa có mật khẩu; policy **nghiêm ngặt như O2**; API `POST /api/auth/set-password`, testid `set-password-*` đã có). Đổi email: không hỗ trợ.
5. **Nút social** hiển thị ở cả tab Đăng nhập và tab Đăng ký, trong khối "hoặc tiếp tục với" (`social-google-btn`, `social-facebook-btn`, `social-error`, `social-loading` — đã có trong FE). Provider nào chưa cấu hình biến môi trường thì ẩn nút đó (BE trả cấu hình công khai qua `GET /api/auth/social/config`, không chứa secret).
6. **Mock cho môi trường test (SOC-MOCK):** chỉ Development/Testing hoặc `Social__MockEnabled=true` (production tắt cứng). Bấm nút provider khi chưa cấu hình thật → mở **panel đồng ý giả lập trong trang** (`social-mock-panel`, `social-mock-confirm-btn`, `social-mock-cancel-btn`, nút có `data-mock="true"`) với 1 user mẫu/provider: Google `google.test@dafl.vn`, Facebook `facebook.test@dafl.vn` (định danh cố định `mock-google-001` / `mock-facebook-001`). Đồng ý → `POST /api/auth/social/mock { provider }` → áp L1/L3 → cấp JWT. Hủy → thông báo như hủy popup thật: "Bạn đã hủy đăng nhập bằng {Google/Facebook}. Vui lòng thử lại hoặc dùng email và mật khẩu."
7. **Lỗi (hiện ở `social-error`):** token hết hạn/sai chữ ký/sai `aud`/`app_id` → "Phiên đăng nhập {Google/Facebook} đã hết hạn hoặc không hợp lệ. Vui lòng thử lại."; mất kết nối nhà cung cấp → "Không kết nối được với {Google/Facebook}. Vui lòng kiểm tra mạng và thử lại."

### 11.2 Voucher / mã giảm giá *(giữ và làm kỹ theo O1)*

1. **Phạm vi:** mỗi đơn áp **tối đa 1 mã**; muốn dùng mã khác phải gỡ mã đang áp trước. Áp được tại giỏ hàng (CN-06) và tại bước thanh toán (CN-07); trạng thái áp mã theo giỏ/tài khoản và được mang sang checkout.
2. **Kiểm tra hai lớp — BE là nơi quyết định:**
   - Khi khách bấm "Áp dụng": BE kiểm tra và trả kết quả dự kiến (số tiền giảm, tổng mới) để FE hiển thị; FE chỉ hiển thị, không tự tính quyền lợi.
   - **Khi đặt hàng, BE kiểm tra LẠI toàn bộ trong cùng transaction của CN-07** (không tin kết quả lúc áp mã, vì điều kiện có thể đã đổi: hết hạn, hết lượt, giỏ thay đổi không còn đạt mức tối thiểu). Kiểm tra không đạt ở bước này → **không tạo đơn**, trả lỗi đúng trường hợp để khách sửa mã/giỏ rồi đặt lại.
3. **Bảng trường hợp kiểm tra và thông báo:**

| Trường hợp | Thông báo |
|---|---|
| Mã không tồn tại | "Mã giảm giá không tồn tại." |
| Mã đã hết hạn / chưa tới thời gian áp dụng | "Mã giảm giá đã hết hạn." |
| Tạm tính chưa đạt mức đơn tối thiểu của mã | "Đơn tối thiểu {X}đ cho mã này" |
| Mã đã hết lượt sử dụng (toàn hệ thống) | "Mã giảm giá đã hết lượt sử dụng." |
| Khách đã dùng hết lượt cho phép của mã này (nếu mã có giới hạn theo khách) | "Bạn đã sử dụng mã này rồi." |
| Áp mã thứ hai khi đang có mã | FE chặn tại chỗ: phải gỡ mã hiện tại trước (nút `remove-voucher-btn`) |

4. **Chống dùng vượt:** lượt sử dụng chỉ được **tăng khi đơn tạo thành công**, tăng trong cùng transaction với tạo đơn (đặt đơn đồng thời không thể cùng vượt lượt). Đơn bị hủy (CN-08.3) → **hoàn lại 1 lượt** dùng của voucher trong cùng transaction hủy.
5. **Lưu vào đơn:** đơn lưu **mã voucher** + **số tiền được giảm**; trang thành công, lịch sử đơn và chi tiết đơn hiển thị tách dòng "Giảm giá (mã {CODE}): −{số tiền}đ" (testid `cart-voucher-discount` ở giỏ/checkout; khối giá ở chi tiết đơn theo CN-08.2).
6. **Mã đang seed (giữ nguyên như hiện tại):** `DAFL10` (−10%, đơn ≥ 100.000đ, giảm tối đa 100.000đ) · `DAFL20` (−20.000đ, đơn ≥ 100.000đ) · `FREESHIP` (miễn phí giao hàng) · `VIP50K` (−50.000đ, đơn ≥ 500.000đ) · `FORDEV` (đơn còn 2.000đ — mã phục vụ test PayOS).

### 11.3 Thanh toán PayOS *(giữ theo O1 — tóm tắt trạng thái hiện tại)*

- Ngoài COD, khách chọn **PayOS** tại CN-07: BE tạo link/QR thanh toán; xác nhận qua **webhook** (verify HMAC-SHA256, **idempotent**) và **polling dự phòng** phía FE — hai đường cho cùng một kết quả.
- **COD chỉ cho đơn ≤ 2.000.000đ**; đơn lớn hơn → COD hiển thị kèm lý do và không chọn được, bắt buộc PayOS.
- Đơn tạo trước với trạng thái vòng đời **Chờ xác nhận**; trạng thái thanh toán (chưa thanh toán/đã thanh toán) là trường riêng (CN-08). Thanh toán PayOS thất bại/hủy → đơn không chuyển trạng thái giao hàng; xử lý giữ chỗ kho theo cơ chế hiện tại (giữ 15 phút khi đang chờ thanh toán).
- Môi trường dev/test dùng **mock PayOS** khi key là `demo_*` (trang giả lập có nút "Giả lập thanh toán thành công", `simulate-payos-success-btn`, `payos-mock-gateway`).

---

## 12. Ánh xạ test case Selenium (theo CN)

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| TC-CN01-01 | Đăng ký hợp lệ → "Đăng ký thành công" → đăng nhập ngay bằng tài khoản vừa tạo | Thành công, không xuất hiện bước OTP |
| TC-CN01-02 | Đăng ký lần lượt sai từng trường (họ tên ngắn, email sai định dạng, SĐT 9 số, SĐT không bắt đầu bằng 0) | Lỗi đúng câu dưới đúng ô, không gửi form |
| TC-CN01-03 | Mật khẩu thiếu chữ hoa / thiếu số / thiếu ký tự đặc biệt / 7 ký tự | Bị chặn; checklist `password-rule-*` phản ánh đúng điều kiện thiếu |
| TC-CN01-04 | Email trùng; SĐT trùng; xác nhận mật khẩu không khớp | Đúng câu lỗi; dữ liệu giữ nguyên trừ mật khẩu |
| TC-CN02-01 | Đăng nhập đúng → header hiện tên + menu tài khoản | JWT được cấp |
| TC-CN02-02 | Sai mật khẩu; email không tồn tại | Cả hai cùng một câu "Email hoặc mật khẩu không đúng", một chỗ duy nhất |
| TC-CN02-03 | Chưa đăng nhập vào /checkout, /orders, /profile | Bị đưa tới đăng nhập; đăng nhập xong quay lại đúng trang |
| TC-CN02-04 | Đăng xuất → bấm Back | Không xem lại được trang riêng tư |
| TC-CN02-05 | Dùng token hết hạn/bị sửa gọi trang riêng tư | Về đăng nhập + `session-expired-notice` |
| TC-CN03-01 | Sửa hồ sơ hợp lệ; SĐT trùng tài khoản khác | "Cập nhật thành công" / "Số điện thoại đã được sử dụng" |
| TC-CN03-02 | Đổi mật khẩu: sai mật khẩu hiện tại; mới trùng cũ; xong đăng nhập lại bằng mật khẩu mới | Đúng thông báo từng trường hợp |
| TC-CN03-03 | Sổ địa chỉ: thêm 5 địa chỉ; thêm thứ 6; địa chỉ đầu tiên tự mặc định; xóa mặc định | Trần 5; luôn đúng 1 mặc định; địa chỉ gần nhất lên thay |
| TC-CN04-01 | Phân trang danh sách | 12 sản phẩm/trang; giữ bộ lọc khi chuyển trang |
| TC-CN04-02 | Tìm kiếm có/không kết quả; từ khóa `' OR 1=1 --` | E1 + nút "Xóa bộ lọc"; chuỗi độc xử lý như chuỗi thường |
| TC-CN04-03 | Lọc danh mục + khoảng giá + sắp xếp kết hợp; giá từ > đến | Kết quả đúng điều kiện; E2 khi từ > đến |
| TC-CN04-04 | Sản phẩm hết hàng / ngừng bán | Hết hàng hiện nhãn, không thêm giỏ được; ngừng bán không hiển thị |
| TC-CN05-01 | Chi tiết: số lượng 0 / 1 / bằng tồn / tồn + 1; biến thể hết hàng; link sản phẩm không tồn tại | Biên xử lý đúng quy tắc; 404 đúng câu |
| TC-CN06-01 | Thêm giỏ khi chưa đăng nhập (ở thẻ + ở chi tiết) | Thêm được ngay, không hiện form đăng nhập; badge tăng đúng |
| TC-CN06-02 | Cộng dồn chạm trần tồn kho; sửa SL biên; xóa có xác nhận | "Chỉ còn X sản phẩm"; giảm về 0 hỏi xác nhận mới xóa |
| TC-CN06-03 | Gộp giỏ: khách thêm 2 sản phẩm → đăng nhập (giỏ tài khoản đã có sẵn 1 sản phẩm trùng) | Trùng cộng dồn không vượt tồn; giỏ tạm bị xóa; giỏ giữ sau đăng xuất → đăng nhập lại |
| TC-CN07-01 | Đặt hàng COD thành công | Mã đơn đúng dạng `DH{yyyyMMdd}-{NNNN}`; tồn kho giảm; giỏ sạch dòng đã đặt; đơn ở Chờ xác nhận |
| TC-CN07-02 | Phí ship ở tạm tính 298.999 và 299.000 | 25.000đ và 0đ (theo O1) |
| TC-CN07-03 | Double click "Đặt hàng"; chưa có địa chỉ; hết hàng lúc đặt | Chỉ 1 đơn; E3; E1 + rollback (giỏ và tồn kho nguyên vẹn) |
| TC-CN07-04 | Voucher: mã sai; mã hết hạn; chưa đạt đơn tối thiểu; mã hợp lệ | Đúng thông báo Mục 11.2; đơn lưu mã + tiền giảm; BE kiểm lại khi đặt (đổi giỏ xuống dưới mức tối thiểu sau khi áp mã → đặt bị chặn) |
| TC-CN08-01 | Danh sách đơn: chỉ thấy đơn của mình; lọc theo trạng thái; phân trang | Đúng phạm vi dữ liệu |
| TC-CN08-02 | Mở chi tiết đơn của người khác bằng URL | "Không có quyền truy cập" hoặc 404 |
| TC-CN08-03 | Hủy đơn Chờ xác nhận kèm lý do | "Hủy đơn thành công"; trạng thái Đã hủy; tồn kho hoàn đúng; hủy lần 2 không hoàn thêm |
| TC-CN08-04 | Hủy đơn ở Đang chuẩn bị (dữ liệu giả lập) | Nút hủy ẩn/khóa + "Vui lòng liên hệ hỗ trợ" |
| TC-SOC-01…06 | *(Mở rộng O3, giữ bộ test của v4)* Social mock: đăng nhập lần đầu tự tạo tài khoản; lần 2 vào đúng tài khoản; liên kết khi email trùng; hủy panel → `social-error`; đặt mật khẩu cho tài khoản social rồi đăng nhập bằng mật khẩu; tab Đăng ký cũng có nút social | Như Mục 11.1 |

**Bộ test cũ bị loại bỏ ở v5:** toàn bộ TC-GATE-*, TC-REG-* (OTP), TC-LOCK-*, TC-FP-* của v3/v4 và các case assert `register-verify-*`, `forgot-*`, `auth-required-notice`.

---

## 13. Tác động lên repo 2 (bộ test Selenium)

Cấu trúc POM giữ nguyên (pageUIs / pageObjects / commons). Thay đổi theo class:

| Class / file | Tác động |
|---|---|
| `AuthTest` | **Sửa lớn.** `registerNewAccountThenLogin`: bỏ bước nhập mã OTP/`debugCode` — đăng ký xong đăng nhập được ngay (TC-CN01-01). Sửa assert câu lỗi đăng nhập sang "Email hoặc mật khẩu không đúng". Bỏ các test quên mật khẩu/khóa mềm nếu có. Thêm: test hết hạn token (TC-CN02-05), test Back sau đăng xuất. |
| `CartManagementTest` | **Sửa lớn.** Bỏ `loginWithDemoAccount()` ở đầu các test thêm giỏ — khách thêm giỏ tự do. Thêm test cộng dồn/trần tồn kho, xác nhận khi xóa, và **test gộp giỏ sau đăng nhập** (TC-CN06-03). Assert tổng tiền giữ nguyên; phí ship assert theo mốc O1 (không đổi). |
| `CatalogAndSearchTest` | **Bổ sung.** Thêm test phân trang 12/trang + giữ bộ lọc, sắp xếp 3 kiểu, khoảng giá từ > đến, chuỗi injection (TC-CN04-01…04). Cần locator mới ở `ProductCatalogPageUI` (Mục 12/CN-04). |
| `CheckoutAndOrderTest` | **Sửa.** `checkoutRequiresLogin`: đổi kỳ vọng — chưa đăng nhập bấm Thanh toán/vào checkout → bị đưa tới **trang đăng nhập** rồi quay lại checkout (không còn assert `auth-required-notice` tại bước thêm giỏ). `placeOrderSuccessfully` + `payWithMockPayosAndSeeOrderInHistory`: giữ helper điền `shipping-*`, thêm chọn địa chỉ từ sổ (hoặc thêm mới), assert **mã đơn dạng DH{yyyyMMdd}-NNNN** và trạng thái **Chờ xác nhận**. Thêm case double-click và case voucher bị BE chặn khi đặt (TC-CN07-03/04). |
| `EndToEndShoppingFlowTest` | **Sửa luồng.** Luồng mới: khách xem hàng → thêm giỏ (không đăng nhập) → đăng nhập (giỏ gộp) → checkout → đặt COD → xem đơn. Bỏ các bước qua cổng/OTP. |
| `NegativeAndExceptionScenariosTest` | **Sửa + dọn.** Xóa case kỳ vọng cổng đăng nhập khi thêm giỏ và các case OTP/khóa mềm/quên mật khẩu. Case áp voucher sai: giữ, cập nhật assert theo bảng thông báo Mục 11.2 và thêm case BE kiểm lại khi đặt. Case "bỏ trống địa chỉ" giữ trên bộ trường `shipping-*`. Thêm case: mở chi tiết đơn của người khác (TC-CN08-02), hủy đơn trái trạng thái. |
| `SocialLoginTest` *(class của đợt v4)* | **Giữ nguyên** (TC-SOC-01…06) — chỉ đổi điểm cuối xác thực: sau mock confirm, assert đã có phiên JWT (header hiện tên tài khoản mẫu) thay cho cookie. |
| Class mới đề xuất: `ProfileAndAddressTest` | CN-03: sửa hồ sơ, đổi mật khẩu (đăng nhập lại bằng mật khẩu mới), sổ địa chỉ (trần 5, mặc định, xóa mặc định). Locator vào `ProfilePageUI` (bổ sung lớn — xem CN-03). |
| Class mới đề xuất: `OrderCancellationTest` | CN-08.3: hủy ở Chờ xác nhận + hoàn tồn kho, hủy 2 lần idempotent, nút hủy bị khóa ở Đang chuẩn bị (dữ liệu giả lập/API seed trạng thái). Locator vào `OrdersPageUI`. |
| `BaseTest` / `GlobalConstants` | Helper `loginWithDemoAccount()` giữ (vẫn dùng cho các test cần tài khoản). Bỏ helper lấy `debugCode` nếu chỉ còn phục vụ OTP. Thêm helper chờ `session-expired-notice` và helper đọc mã đơn dạng DH. |
| JMeter (repo 2) | Kịch bản hiệu năng chuyển từ Cookie Manager (phiên `sid`) sang **Authorization header** (đăng nhập lấy JWT một lần ở Thread Group setup rồi truyền biến). Quality Gate không đổi. |

## 14. Ghi chú triển khai

- **BE — JWT:** phát hành JWT (HS256) khi đăng nhập mật khẩu và social: claims tối thiểu `sub` (user id), `email`, `fullName`, `exp` = +1 giờ; khóa ký lấy từ cấu hình `JWT_SECRET` (Mục 15). Middleware xác thực Bearer cho các API cần đăng nhập (hồ sơ, giỏ server, địa chỉ, checkout, đơn hàng); API công khai (catalog, chi tiết, đăng ký, đăng nhập, social) không yêu cầu token. Trả **401** khi thiếu/hết hạn/sai chữ ký để FE đi nhánh CN-02-E3. Bỏ cơ chế session cookie `sid` + bảng `UserSession` khỏi đường xác thực chính; SignalR (thông báo realtime) chuyển sang xác thực bằng JWT (access token qua query string của hub như chuẩn SignalR). Token hết hạn **không** có refresh token ở v5 (đúng CN: hết hạn thì đăng nhập lại).
- **BE — Giỏ hàng server:** kích hoạt dùng thật API giỏ hàng theo tài khoản (bảng `Cart`/`CartItem` đã có): mọi thao tác giỏ khi đã đăng nhập đi qua API; endpoint gộp giỏ `POST /api/cart/merge` nhận danh sách giỏ tạm (productId, variantId, quantity) → cộng dồn có trần tồn kho trong một transaction → trả giỏ sau gộp + danh sách dòng bị cắt giảm. Kiểm tra tồn kho/giá mới nhất khi mở giỏ và khi checkout (CN-06.5, CN-07 bước 2).
- **BE — Đăng ký/đăng nhập:** bỏ tạo bản ghi OTP + trạng thái chờ xác thực khỏi luồng đăng ký (`User.EmailVerified` giữ cột nhưng tài khoản mật khẩu mới tạo đặt `true` ngay — hoặc ngừng dùng cờ này cho làn mật khẩu; ghi rõ lựa chọn khi code). Kiểm tra trùng email **và SĐT** ở register (thêm unique/check cho `PhoneNumber`). Bỏ endpoint quên mật khẩu/OTP/khóa mềm khỏi bề mặt API chuẩn (đánh dấu deprecated/xóa); bỏ các trường đếm sai/khóa khỏi logic đăng nhập (cột giữ lại trong DB cũng được, không dùng).
- **BE — Đơn hàng:** thêm sinh **mã đơn DH{yyyyMMdd}-{NNNN}** — số thứ tự theo ngày có khóa chống trùng (bảng đếm theo ngày hoặc unique index + retry trong transaction); mã số nguyên phục vụ PayOS giữ riêng như hiện tại, không dùng làm mã hiển thị. Tách **trạng thái vòng đời** (`ChoXacNhan`, `DangChuanBi`, `DangGiao`, `DaGiao`, `DaHuy`) khỏi **trạng thái thanh toán** (chưa/đã thanh toán) trên `Order`; thêm `CancelReason`, `CancelledAt`, bảng/lịch sử mốc trạng thái (`OrderStatusHistory` đã có). Endpoint hủy đơn: kiểm quyền sở hữu + trạng thái = Chờ xác nhận **ngay trong transaction**, hoàn tồn kho + hoàn lượt voucher, idempotent khi gọi lặp. API giả lập chuyển trạng thái (chỉ Development/Testing) để test CN-08 ở các trạng thái sau.
- **BE — Voucher:** chuyển toàn bộ kiểm tra voucher về BE theo Mục 11.2; tăng lượt dùng trong transaction đặt đơn, hoàn lượt trong transaction hủy đơn.
- **FE — Dọn luồng cũ:** gỡ cổng thêm giỏ + `auth-required-notice` + hành động chờ (pending action); gỡ bước xác thực OTP sau đăng ký, toàn bộ view/testid `forgot-*`, `login-attempts-warning`; gỡ/ẩn khối yêu thích và đánh giá khỏi UI; form đăng ký bỏ ô địa chỉ. Đổi nơi lưu phiên: token JWT ở localStorage (`dafl_token`), đính kèm header ở lớp gọi API trung tâm; interceptor 401 → xóa token + về đăng nhập + `session-expired-notice`. Giỏ khách ở localStorage (`dafl_guest_cart`); sau đăng nhập gọi merge rồi chuyển hẳn sang giỏ server.
- **FE — Bổ sung:** các testid còn thiếu liệt kê ở từng mục CN (tổng hợp ở Mục 12 của báo cáo bàn giao); form đổi mật khẩu + sổ địa chỉ đầy đủ ở trang Hồ sơ; trang chi tiết gắn testid số lượng/Mua ngay/biến thể; danh sách đơn có testid từng đơn + lọc + phân trang; hộp thoại hủy đơn.
- **Dữ liệu/schema:** DB vẫn `EnsureCreated` (không migration) → đổi schema thì tạo lại DB dev (`docker compose down -v`). Bảng `OtpCode` và các cột khóa mềm không còn được dùng (để nguyên trong DB, không xóa dữ liệu cũ). Dữ liệu địa giới tĩnh `vietnam-provinces.json` giữ nguyên như v4.
- **Giữ nguyên:** toàn bộ `data-testid` đang có và được liệt kê "đã có" ở từng CN; tài khoản demo `demo@dafl.vn`; các voucher seed; hạ tầng PayOS/Kafka/SignalR; phí ship O1; GLOW đứng ngoài phạm vi (Mục 0.3).

## 15. Việc Daniel phải tự làm (cấu hình bên ngoài — Muse không làm thay được)

1. **JWT (mới ở v5):** thêm vào `.env` cạnh `docker-compose.yml`: `JWT_SECRET=<chuỗi ngẫu nhiên dài tối thiểu 32 ký tự>` — dùng để ký JWT hạn 1 giờ. Không đặt biến này thì BE dùng khóa dev mặc định **chỉ cho môi trường Development** (tài liệu ghi rõ: không dùng khóa mặc định khi deploy thật). Secret không commit lên Git.
2. **Google OAuth client:** Google Cloud Console → project "DAFL" → OAuth consent (External) → Credentials → OAuth client ID loại **Web application** → Authorized JavaScript origins: `http://localhost:3000` (và domain thật khi deploy) → điền `.env`: `GOOGLE_CLIENT_ID=...`. (Luồng GIS dùng `id_token` nên không cần Client Secret.)
3. **Meta app:** Meta for Developers → Create App (Consumer) → thêm sản phẩm **Facebook Login** → khai domain `localhost`/domain thật → điền `.env`: `FACEBOOK_APP_ID=...`, `FACEBOOK_APP_SECRET=...` (App Secret **chỉ ở BE**, không commit). Lưu ý app ở chế độ Development chỉ cho tài khoản có role/tester đăng nhập — thêm tài khoản Facebook của mình làm Tester khi test thật.
4. **SMTP/Gmail: KHÔNG còn bắt buộc ở v5.** Vì đã bỏ xác thực OTP khi đăng ký và bỏ quên mật khẩu, hệ thống **không cần gửi email OTP** nữa → không cần tạo Gmail App Password cho các luồng chuẩn CN. Hai biến `SMTP_USER`/`SMTP_PASSWORD` chỉ còn ý nghĩa nếu sau này bật lại email thông báo (không thuộc v5); nhánh phụ L4 của social (Facebook không trả email) khi chạy thật sẽ cần một kênh gửi mã — ở môi trường test dùng cơ chế hiển thị mã test như trước. **Đây là thay đổi so với v4** (v4 bắt buộc SMTP để gửi OTP).
5. **PayOS:** giữ nguyên cấu hình hiện tại (`PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` trong `.env`; để `demo_*` thì chạy mock).
6. **Tạo PR và nhờ merge:** mở PR từ fork `linh1912/DAFL` (nhánh `develop`) vào `sonismyname/DAFL:develop`, nhờ chủ repo merge.
7. `.env` chứa secret: không commit (đã có `.gitignore`); repo chỉ commit `.env.example` — nhớ bổ sung dòng `JWT_SECRET=` vào `.env.example` khi code.

## 16. Các điểm bản v5 THAY so với v4

| Điểm ở v4 | Bản v5 | Ghi chú |
|---|---|---|
| Cổng đăng nhập ở bước thêm giỏ (GATE-01..06), hành động chờ, tự thêm sau đăng nhập | **Bỏ hẳn** — khách thêm giỏ tự do (CN-06.1) | Đổi hành vi lớn nhất; test TC-GATE-* bị loại |
| Đăng ký + xác thực OTP cứng mới dùng được tài khoản | Đăng ký xong **dùng ngay**, không OTP (CN-01) | Bỏ trạng thái S2–S5, bỏ `register-verify-*` |
| Quên mật khẩu 3 bước OTP/link | **Bỏ** | Ngoài phạm vi CN |
| Khóa mềm + CAPTCHA theo số lần sai mật khẩu | **Bỏ** — sai chỉ trả 1 câu chung (CN-02-E1) | Bỏ TC-LOCK-* |
| Policy mật khẩu 4 quy tắc nghiêm ngặt | **Giữ nguyên** (O2 đính chính) | Điểm duy nhất của v4 được giữ nguyên trạng trong CN-01/03 |
| Phiên cookie `sid` HttpOnly 7 ngày | **JWT hạn 1 giờ** (CN-02) | Ảnh hưởng FE (lưu token), BE (middleware), SignalR, JMeter |
| Giỏ chỉ tồn tại theo tài khoản, FE quản lý state + gửi `items[]` khi checkout | **Giỏ hai tầng:** khách localStorage / đăng nhập **server** + **gộp giỏ khi đăng nhập** (CN-06.4) | BE dùng thật API `/api/cart` + endpoint merge |
| Giảm số lượng về 0 = xóa ngay | Giảm về 0 hoặc bấm Xóa → **hỏi xác nhận** (CN-06.3) | Đổi hành vi nhỏ, test phải sửa |
| Form đăng ký có ô địa chỉ bắt buộc | **Bỏ ô địa chỉ** khỏi form đăng ký; địa chỉ nằm ở sổ địa chỉ (CN-03.3) + checkout (CN-07) | Theo đúng form CN-01 |
| Sổ địa chỉ: không giới hạn số lượng | **Tối đa 5**, địa chỉ đầu tiên tự mặc định, xóa mặc định → địa chỉ gần nhất lên thay (CN-03.3) | Thêm quy tắc trần |
| Ghi chú giao hàng ≤ 500 ký tự | **Ghi chú đơn ≤ 200 ký tự** (CN-07) | Dùng chung ô `shipping-note-input`, đổi giới hạn |
| Trạng thái đơn kiểu thanh toán (`Pending → Paid/Cancelled/Expired`) | **Vòng đời CN:** Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao / Đã hủy; thanh toán tách trường riêng | Thêm **hủy đơn + hoàn tồn kho** (CN-08.3) — v4 chưa có hủy đơn phía khách |
| Mã đơn là mã số (phục vụ PayOS) | Thêm **mã hiển thị DH{yyyyMMdd}-{NNNN}**; mã PayOS giữ riêng | CN-07 |
| Câu lỗi đăng nhập "Email hoặc mật khẩu không chính xác." | **"Email hoặc mật khẩu không đúng"** | Theo CN-02-E1; sửa assert ở test |
| Social login cấp cookie `sid` | Social login cấp **JWT** như đăng nhập thường; còn lại giữ thiết kế v4 (verify token, L1–L5, mock) | O3 |
| Yêu thích + đánh giá hiển thị trên UI | **Ẩn/gỡ khỏi UI** | Ngoài 8 chức năng CN |
| GLOW Member là Luồng 8 có đặc tả đầy đủ | **Đứng ngoài phạm vi v5** (giữ nguyên code, không đặc tả lại, không vào bộ test chuẩn) | Cần quyết định riêng nếu muốn gỡ/khôi phục |
| SMTP Gmail là cấu hình bắt buộc để gửi OTP | **Không còn bắt buộc** (Mục 15.4) | Hệ quả của bỏ OTP/quên mật khẩu |
| Phí ship 25.000đ / freeship ≥ 299.000đ; voucher 5 mã seed; PayOS + COD | **Giữ nguyên toàn bộ** (O1) + voucher được đặc tả "làm kỹ" ở Mục 11.2 | Override của chủ đồ án |

*Nguồn đặc tả: `DAC-TA-CN-01-08.md` (CN-01..CN-08 nguyên văn + override O1/O2/O3 đã chốt 2026-11-01, gồm đính chính O2 giữ policy mật khẩu nghiêm ngặt). Các bản trước (v4 tại `LUONG-NGHIEP-VU-DAFL-BAN-CHOT.md` lịch sử git, `THIET-KE-NGHIEP-VU-MOI-DAFL.md`) chỉ còn giá trị tham khảo lịch sử.*
