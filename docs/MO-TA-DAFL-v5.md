# MÔ TẢ DỰ ÁN DAFL — BẢN v5 (dùng cho báo cáo đồ án)

> Cập nhật: 01/11/2026, theo đặc tả nghiệp vụ **bản chốt v5** (`LUONG-NGHIEP-VU-DAFL-BAN-CHOT.md`) — tổ chức theo **8 chức năng chuẩn CN-01..CN-08** cộng 3 override của chủ đồ án (giữ PayOS + phí ship hiện tại + voucher làm kỹ; giữ policy mật khẩu nghiêm ngặt; giữ social login).
> - **Repo 1 (sản phẩm / SUT):** https://github.com/sonismyname/DAFL.git — nhánh làm việc `develop`. Các bản nâng cấp được phát triển trên fork https://github.com/linh1912/DAFL (nhánh `develop`) và đưa vào repo chính bằng Pull Request.
> - **Repo 2 (đồ án kiểm thử):** https://github.com/xuanlepham/DAFL_DO_AN_TOT_NGHIEP.git — nhánh `main`. Repo này **không chứa FE/BE**, chỉ chứa tầng kiểm thử (Selenium + JMeter + Jenkins + Quality Gate); khi Jenkins chạy, nó clone Repo 1 vào thư mục `sut/` và kiểm thử hộp đen.
> Đề tài đồ án: **Xây dựng và đánh giá quy trình Continuous Testing có Quality Gate tự động** trên hệ thống thương mại điện tử DAFL.

---

## 0. DAFL là gì — hiểu trong 30 giây

DAFL là web thương mại điện tử bán **mỹ phẩm** (giao diện theo format trang Flash Sale của các sàn mỹ phẩm: thanh vàng trên cùng, header trắng 3 vùng, pill danh mục pastel, sidebar lọc trái, lưới sản phẩm 4 cột, thẻ sản phẩm có thương hiệu/giá sale, band newsletter vàng, footer nhiều cột — chỉ lấy **bố cục**, giữ nguyên tên, logo và dữ liệu của DAFL). Luồng mua hàng theo chuẩn CN: xem/tìm/lọc sản phẩm (không cần tài khoản) → thêm vào giỏ (**khách vãng lai dùng được giỏ**, giỏ tự **gộp vào tài khoản** khi đăng nhập) → chọn địa chỉ giao hàng từ sổ địa chỉ → đặt hàng **COD hoặc PayOS** (có áp voucher) → theo dõi vòng đời đơn (**Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao**) và **hủy đơn** khi còn Chờ xác nhận. Đăng nhập dùng **JWT hạn 1 giờ**; có thêm kênh đăng nhập Google/Facebook.

```
Repo 2 (Continuous Testing)
   │  Jenkins Pipeline tự clone Repo 1 vào sut/
   ▼
Repo 1 (SUT) = Web bán hàng DAFL
   ├── Frontend :3000  (React + Vite, Nginx khi đóng gói Docker)
   └── Backend  :5000 → container :8080  (.NET 8 Minimal API, xác thực JWT)
          ├── PostgreSQL 16 · Kafka 3.7 (KRaft)
          ├── PayOS (thật hoặc mock) · Voucher (BE kiểm tra lại khi đặt hàng)
          └── Google / Facebook OAuth (verify token phía BE, cấu hình qua .env)
   ▲
   │ Kiểm thử hộp đen qua UI + API
Repo 2: Selenium UI test + JMeter performance test + 2 Quality Gate → PASS mới Deploy
```

---

# PHẦN A — KIẾN TRÚC & CÔNG NGHỆ

| Tầng | Công nghệ |
|---|---|
| Frontend | React 18.3 + TypeScript 5.6 + Vite 5.4, React Router 7, SignalR client, lucide-react, CSS thuần theo hệ token (vàng `#FFD900`, đỏ sale `#E40046`, nền trắng) — không gradient, không thư viện UI nặng |
| Backend | .NET 8, **Minimal API** (không Controller), **Vertical Slice Architecture + CQRS** với MediatR, FluentValidation, EF Core 8, BCrypt, **JWT (HS256, hạn 1 giờ)** cho xác thực |
| Xác thực | **JWT Bearer** — đăng nhập (mật khẩu hoặc social) → BE cấp JWT 1 giờ; FE lưu token ở localStorage, gửi `Authorization: Bearer`; 401 → về đăng nhập kèm "Phiên đăng nhập đã hết hạn". *(v5 thay cơ chế cookie phiên `sid` 7 ngày của các bản trước.)* |
| Database | PostgreSQL 16 — EF Core Code-First với `EnsureCreated` (không dùng Migration; đổi schema thì tạo lại DB dev) |
| Cache | Redis qua lớp `ResilientCacheService` — **mặc định TẮT**, tự fallback In-Memory, Redis chết không sập app |
| Messaging / Realtime | Apache Kafka (Confluent.Kafka, có fallback ghi log khi Kafka sập) + SignalR Hub `/hubs/notifications` (xác thực bằng JWT) |
| Thanh toán | PayOS (verify HMAC-SHA256, webhook idempotent, polling dự phòng) + COD (đơn ≤ 2.000.000đ); có **mock PayOS** khi dùng key demo |
| Đăng nhập mạng xã hội *(mở rộng ngoài CN)* | Google Identity Services (`id_token`, BE verify bằng `Google.Apis.Auth`) + Facebook Login (BE verify qua Graph API `debug_token` + `/me`); có **mock social login** ở Development/Testing phục vụ Selenium |
| Email | **Không còn bắt buộc ở v5** — đã bỏ xác thực OTP khi đăng ký và quên mật khẩu nên hệ thống không cần gửi email cho các luồng chuẩn; SMTP chỉ còn là tùy chọn cho thông báo |
| Đóng gói | Docker Compose 4 service: `postgres`, `kafka`, `backend`, `frontend` (Nginx serve FE + reverse proxy `/api/`, `/hubs/` về backend) |
| Test trong repo 1 | Backend xUnit + Frontend Vitest |
| Test ở repo 2 | Selenium Java/TestNG theo POM, JMeter, 2 Quality Gate, 3 Jenkins job (Phần D) |

**Cấu trúc code chính (repo 1):**
- `src/Backend/Program.cs` — trung tâm: DI, middleware (gồm xác thực JWT), khai báo toàn bộ endpoint Minimal API theo module. Mỗi tính năng là 1 "slice" trong `Features/<Module>/` (Command/Query + Handler + Validator), gọi qua MediatR; 2 pipeline behavior: Validation → Caching. Chuẩn trả về thống nhất `ApiResponse<T> { success, data, message, errors[] }`.
- `src/Frontend/src/App.tsx` — file trung tâm chứa state + mọi route; component tách theo thư mục `components/{auth,cart,checkout,product,common}`; dữ liệu địa giới giao hàng đóng gói tĩnh ở `src/data/vietnam-provinces.json`. Mọi phần tử quan trọng đều có `data-testid` — đây là "mỏ neo" để Selenium bám vào.
- FE có **fallback offline**: fetch lỗi thì hiển thị dữ liệu mẫu trong `mockData.ts` để trang vẫn xem được khi BE ngừng.

---

# PHẦN B — TÍNH NĂNG (theo 8 chức năng chuẩn CN + phần mở rộng)

## B1. CN-01 — Đăng ký

Form họ tên, email, SĐT, mật khẩu, xác nhận mật khẩu. Quy tắc: họ tên 2–50 ký tự; email đúng định dạng và **duy nhất**; SĐT bắt buộc, 10 số bắt đầu bằng 0 và **duy nhất**; **policy mật khẩu nghiêm ngặt giữ từ v3**: tối thiểu 8 ký tự + chữ hoa + chữ số + ký tự đặc biệt, hiển thị dạng **checklist lưới 2×2 chuyển xanh theo tiến độ gõ**; xác nhận phải trùng khớp. Mật khẩu lưu bằng **bcrypt**. Đăng ký thành công → hiện "Đăng ký thành công" và chuyển sang form đăng nhập — **không có bước xác thực OTP** (đây là điểm v5 khác hẳn v3/v4). Lỗi hiện đỏ ngay dưới từng ô theo đúng câu chữ đặc tả; email/SĐT trùng báo tại đúng ô và giữ nguyên dữ liệu đã nhập trừ mật khẩu.

## B2. CN-02 — Đăng nhập / Đăng xuất

- Đăng nhập email + mật khẩu → BE cấp **JWT hạn 1 giờ** → client lưu token, quay về trang trước đó; header hiện tên người dùng + menu tài khoản. Sai thông tin: **một câu chung "Email hoặc mật khẩu không đúng"**, hiện một chỗ duy nhất, không lộ sai ở đâu. **Không còn** khóa mềm/CAPTCHA theo số lần sai và không còn quên mật khẩu (ngoài phạm vi CN).
- Vào trang cần đăng nhập (thanh toán, đơn hàng, hồ sơ) khi chưa đăng nhập → bị đưa tới trang đăng nhập, xong **quay lại đúng trang đó**. Token hết hạn khi đang thao tác → về đăng nhập kèm **"Phiên đăng nhập đã hết hạn"**.
- Đăng xuất: xóa token phía client, về trang chủ. Đăng xuất không xóa giỏ tài khoản trên server.
- Ngay sau đăng nhập thành công, **giỏ tạm của khách được gộp vào giỏ tài khoản** (xem CN-06).

## B3. CN-03 — Quản lý thông tin cá nhân

- **Hồ sơ:** xem/sửa họ tên + SĐT (validate như CN-01, SĐT không được trùng tài khoản khác); **email chỉ hiển thị, không sửa được**. Lưu thành công → "Cập nhật thành công".
- **Đổi mật khẩu:** nhập mật khẩu hiện tại + mật khẩu mới + xác nhận; kiểm tra mật khẩu hiện tại đúng, mật khẩu mới đạt policy nghiêm ngặt và **khác mật khẩu cũ**; cập nhật bằng bcrypt.
- **Sổ địa chỉ giao hàng:** địa chỉ gồm người nhận, SĐT, Tỉnh/Thành phố – Quận/Huyện – Phường/Xã (3 select nối cấp từ dữ liệu tĩnh), địa chỉ cụ thể. **Tối đa 5 địa chỉ**; địa chỉ đầu tiên tự là **mặc định**; luôn đúng 1 địa chỉ mặc định (xóa mặc định → địa chỉ còn lại gần nhất lên thay). Thêm/sửa/xóa/đặt mặc định ngay trong trang Hồ sơ và dùng lại ở checkout.

## B4. CN-04 — Danh sách, tìm kiếm, lọc sản phẩm (không cần đăng nhập)

Phân trang **12 sản phẩm/trang**; thẻ sản phẩm có ảnh, tên, giá (giá khuyến mãi nếu có) và nhãn **"Hết hàng"** khi tồn kho = 0. Kết hợp được: **tìm kiếm** theo tên (không phân biệt hoa thường), **lọc danh mục**, **lọc khoảng giá** (từ–đến), **sắp xếp** (mới nhất mặc định / giá tăng dần / giá giảm dần); bộ lọc được **giữ nguyên khi chuyển trang**. Không có kết quả → "Không tìm thấy sản phẩm phù hợp" + nút "Xóa bộ lọc"; khoảng giá từ > đến → báo lỗi, không lọc; từ khóa chứa mã độc được xử lý như chuỗi thường (chống SQLi/XSS). Sản phẩm ngừng bán không hiển thị; hết hàng vẫn hiển thị nhưng không thêm giỏ được.

## B5. CN-05 — Chi tiết sản phẩm (không cần đăng nhập)

Hiển thị bộ ảnh (gallery), tên, mã sản phẩm, giá gốc/giá khuyến mãi, mô tả, tồn kho và biến thể (nếu có). Chọn biến thể + số lượng (mặc định 1, **1 ≤ số lượng ≤ tồn kho của biến thể**; biến thể hết hàng bị làm mờ không chọn được; nút mua khóa khi hết hàng). **"Thêm vào giỏ"** → CN-06; **"Mua ngay"** → thêm vào giỏ rồi sang thẳng thanh toán CN-07. Sản phẩm không tồn tại/ngừng bán → trang **"404 - Không tìm thấy sản phẩm"**.

## B6. CN-06 — Giỏ hàng

- **Thêm vào giỏ:** từ thẻ sản phẩm (biến thể mặc định) hoặc trang chi tiết — **khách chưa đăng nhập cũng thêm được, không có cổng đăng nhập**. Trùng biến thể → cộng dồn; vượt tồn kho → chỉ thêm tới mức tối đa + báo **"Chỉ còn X sản phẩm"**. Cập nhật badge giỏ + thông báo "Đã thêm vào giỏ hàng".
- **Xem giỏ:** mỗi dòng ảnh, tên, biến thể, đơn giá, số lượng, thành tiền; cuối giỏ có tạm tính + nút "Thanh toán". Giỏ trống → "Giỏ hàng trống" + nút "Tiếp tục mua sắm", ẩn nút thanh toán.
- **Sửa/xóa:** +/− hoặc nhập số → kiểm tra tồn kho, tính lại ngay; vượt tồn → về mức tối đa + thông báo. Giảm về 0 hoặc bấm "Xóa" → **hỏi xác nhận** mới xóa.
- **Lưu giỏ hai tầng + gộp giỏ:** chưa đăng nhập → giỏ ở **localStorage**; đã đăng nhập → giỏ **trên server theo tài khoản** (API `/api/cart`), giữ qua đăng xuất/đăng nhập lại. Khi đăng nhập: gộp giỏ tạm vào giỏ tài khoản (trùng → cộng dồn, không vượt tồn kho) rồi xóa giỏ tạm.
- **Đồng bộ:** mỗi lần mở giỏ lấy lại giá + tồn kho mới nhất; giá đổi → cập nhật + thông báo; sản phẩm ngừng bán/hết hàng → đánh dấu, không cho thanh toán dòng đó.
- **Voucher tại giỏ:** nhập mã ở khối voucher trong giỏ (chi tiết ở B9).

## B7. CN-07 — Đặt hàng

Tiền điều kiện: đã đăng nhập (chưa đăng nhập → qua đăng nhập rồi quay lại), giỏ có ≥ 1 sản phẩm hợp lệ, đã có ≥ 1 địa chỉ giao hàng. Hệ thống kiểm tra lại từng sản phẩm (còn bán, đủ tồn, giá hiện tại) rồi hiển thị trang thanh toán: **địa chỉ giao hàng** (mặc định được chọn sẵn, đổi/thêm mới được), danh sách sản phẩm, **phương thức thanh toán COD hoặc PayOS**, ghi chú đơn (tùy chọn, **tối đa 200 ký tự**). Tính tiền tách dòng: **Tạm tính − Giảm voucher + Phí ship = Tổng**, với **phí ship 25.000đ, miễn phí khi tạm tính ≥ 299.000đ** (giữ theo override O1). Bấm "Đặt hàng" → **một transaction**: kiểm tra tồn kho lần cuối → tạo đơn với **mã dạng DH20261101-0001** + chi tiết đơn lưu **giá tại thời điểm mua** và **bản sao địa chỉ** → trừ tồn kho → xóa sản phẩm đã đặt khỏi giỏ → trạng thái **Chờ xác nhận** → trang "Đặt hàng thành công". Ngoại lệ được xử lý rõ: hết hàng lúc đặt → rollback + báo sản phẩm nào (E1); giá đổi → hiện giá mới yêu cầu xác nhận lại (E2); chưa có địa chỉ → không cho đặt (E3); hai khách cùng mua món cuối → chỉ một người thành công (E4); **double click chỉ tạo 1 đơn** (E5); lỗi giữa chừng → rollback, không mất giỏ/không trừ kho (E6).

## B8. CN-08 — Xem và hủy đơn hàng

- **Danh sách đơn:** chỉ đơn của chính khách, mới nhất trước, có phân trang và **lọc theo trạng thái**; mỗi dòng có mã đơn, ngày đặt, tổng tiền, trạng thái. Chưa có đơn → "Bạn chưa có đơn hàng nào".
- **Chi tiết đơn:** mã, ngày, trạng thái, sản phẩm (ảnh, tên, biến thể, giá, số lượng), địa chỉ nhận (bản sao), phương thức thanh toán, phí ship, tổng tiền, **lịch sử các mốc trạng thái**. Đơn của người khác (sửa URL) → "Không có quyền truy cập" hoặc 404 — BE kiểm tra quyền sở hữu ở mọi API.
- **Vòng đời trạng thái:** **Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao**; nhánh phụ **Chờ xác nhận → Đã hủy**. Các chuyển trạng thái từ Đang chuẩn bị trở đi do admin thực hiện (ngoài phạm vi phía khách; phục vụ test bằng dữ liệu mẫu/API giả lập). Trạng thái thanh toán là trường riêng với vòng đời giao hàng.
- **Hủy đơn:** chỉ khi **Chờ xác nhận** — hộp thoại chọn/nhập **lý do**, xác nhận → một transaction: trạng thái → Đã hủy, lưu lý do + thời điểm hủy, **hoàn tồn kho từng dòng** (và hoàn lượt voucher nếu đơn có dùng mã). Báo "Hủy đơn thành công". Từ Đang chuẩn bị trở đi: ẩn/khóa nút hủy + "Vui lòng liên hệ hỗ trợ". Hủy là thao tác **idempotent**: hủy hai lần không hoàn kho hai lần.

## B9. Phần mở rộng ngoài CN (giữ theo override của chủ đồ án)

- **Voucher — làm kỹ (O1):** 1 mã/đơn; kiểm tra **hai lớp** — lúc áp mã BE trả kết quả dự kiến, và **khi đặt hàng BE kiểm tra lại toàn bộ trong cùng transaction** (mã tồn tại, còn hiệu lực, đạt mức đơn tối thiểu, còn lượt dùng). Mỗi trường hợp lỗi có thông báo riêng ("Mã giảm giá không tồn tại.", "Mã giảm giá đã hết hạn.", "Đơn tối thiểu {X}đ cho mã này", "Mã giảm giá đã hết lượt sử dụng."...). Lượt dùng chỉ tăng khi đơn tạo thành công và được **hoàn lại khi hủy đơn**. Đơn **lưu mã voucher + số tiền được giảm**, hiển thị tách dòng trong bảng giá. Mã seed: `DAFL10` −10% (đơn ≥ 100k, trần 100k) · `DAFL20` −20k (đơn ≥ 100k) · `FREESHIP` miễn phí giao hàng · `VIP50K` −50k (đơn ≥ 500k) · `FORDEV` đơn còn 2.000đ (phục vụ test PayOS).
- **PayOS (O1):** thanh toán online song song COD — webhook verify **HMAC-SHA256** + **idempotent**, polling dự phòng phía FE; **COD chỉ cho đơn ≤ 2.000.000đ**, lớn hơn bắt buộc PayOS. Key `demo_*` → trang mock PayOS có nút "Giả lập thanh toán thành công" phục vụ test/demo.
- **Social login Google/Facebook (O3):** FE lấy token (Google GIS `id_token` / Facebook JS SDK `access_token`) → BE **xác thực trực tiếp với nhà cung cấp** → tra bảng `UserExternalIdentity`: có định danh → đăng nhập; email trùng tài khoản cũ (đã được nhà cung cấp xác thực) → **tự liên kết**; chưa có → **tự tạo tài khoản, email coi như đã xác thực**. Sau đó cấp **JWT** như đăng nhập thường. Tài khoản social chưa có mật khẩu → đặt mật khẩu (policy nghiêm ngặt) tại trang Hồ sơ. Có **mock social login** ở Development/Testing (user mẫu `google.test@dafl.vn` / `facebook.test@dafl.vn`) để Selenium kiểm thử.
- **Thông tin giao hàng có cấu trúc** (kế thừa v4, nay thuộc CN-03.3/CN-07): 3 select Tỉnh/Quận/Phường từ dữ liệu tĩnh đóng gói cùng FE (`vietnam-provinces.json`) — chọn phương án này vì xác định cho Selenium và không phụ thuộc dịch vụ ngoài khi chạy CI; đơn lưu **snapshot** địa chỉ bất biến.
- **Ngoài phạm vi v5:** cổng đăng nhập ở bước thêm giỏ, xác thực OTP khi đăng ký, quên mật khẩu, khóa mềm tài khoản, yêu thích và đánh giá trên UI (đã loại bỏ theo đặc tả CN); GLOW Member giữ nguyên trạng thái code cũ, không thuộc phạm vi chuẩn và không mở rộng thêm.

## B10. Hạ tầng phụ trợ

- **Realtime:** SignalR (xác thực bằng JWT) + polling trạng thái thanh toán; thông báo còn publish qua Kafka (`payment-events`, `notification-events`) với cơ chế fallback khi Kafka sập.
- **Chống bán trùng kho:** `Product.Version` làm optimistic concurrency token; tồn khả dụng = Stock − ReservedStock; đặt đơn và hủy đơn đều thao tác tồn kho trong transaction.
- **Cache:** Redis tắt mặc định, fallback In-Memory qua `ResilientCacheService`.
- **Chuẩn giao diện form** (kế thừa v3.1): không popup validation của trình duyệt — lỗi đỏ inline dưới từng ô; chuyển tab auth xóa sạch lỗi; input được trim trước khi validate.

---

# PHẦN C — DỮ LIỆU, TÀI KHOẢN TEST & CẤU HÌNH

## C1. Cơ sở dữ liệu (EF Core, `EnsureCreated`)

Các bảng chính: `User` (mật khẩu bcrypt; các cột xác thực/khóa mềm của v3 còn trong schema nhưng v5 không dùng), `UserExternalIdentity` (định danh Google/Facebook — phần mở rộng), `UserAddress` (sổ địa chỉ, tối đa 5/khách theo quy tắc nghiệp vụ), `Cart`, `CartItem` (giỏ server theo tài khoản — v5 dùng thật, có gộp giỏ khi đăng nhập), `Category`, `Product`, `Voucher` (có lượt dùng, được kiểm tra lại khi đặt hàng), `Order` (mã hiển thị **DH{yyyyMMdd}-{NNNN}**, các cột **snapshot giao hàng**, trạng thái **vòng đời CN** tách khỏi trạng thái thanh toán, `CancelReason`/`CancelledAt`), `OrderItem` (giá tại thời điểm mua), `OrderStatusHistory` (lịch sử mốc trạng thái), `PaymentTransaction`, `Notification`, `Evaluation` (dữ liệu cũ, UI đã ẩn ở v5). Xác thực JWT là stateless nên không cần bảng phiên (bảng `UserSession` của các bản trước không còn dùng cho đăng nhập).
Seed tự chạy khi BE khởi động (idempotent): 26 danh mục, ~104 sản phẩm mỹ phẩm, voucher ở mục B9, tài khoản demo/admin.

## C2. Tài khoản & dữ liệu phục vụ kiểm thử

| Đối tượng | Giá trị |
|---|---|
| Tài khoản demo | `demo@dafl.vn` / `Password123!` (đăng nhập bằng cách gõ tay — nút điền nhanh đã bỏ khỏi UI từ v3.1) |
| Voucher test | `DAFL10`, `DAFL20`, `FREESHIP`, `VIP50K`, `FORDEV` (đơn còn 2.000đ cho test PayOS) |
| Mock social | User mẫu cố định: Google `google.test@dafl.vn`, Facebook `facebook.test@dafl.vn` (panel `social-mock-panel`) — chỉ Development/Testing |
| Mock PayOS | Khi key PayOS là `demo_*`: trang mock PayOS giả lập thanh toán |
| API giả lập trạng thái đơn | Chỉ Development/Testing: chuyển đơn sang Đang chuẩn bị/Đang giao/Đã giao để test CN-08 (phía admin không thuộc phạm vi đồ án) |

## C3. Cấu hình qua `.env` (cạnh `docker-compose.yml`, **không commit file chứa secret** — repo chỉ có `.env.example`)

| Biến | Ý nghĩa |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database (có giá trị mặc định cho dev) |
| `BACKEND_PORT` (mặc định 5000), `FRONTEND_PORT` (mặc định 3000) | Cổng host |
| `JWT_SECRET` *(mới ở v5)* | Khóa ký JWT (tối thiểu 32 ký tự). Không đặt → BE dùng khóa dev mặc định, **chỉ chấp nhận ở Development** |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | PayOS thật; để `demo_*` thì chạy mock |
| `GOOGLE_CLIENT_ID` | OAuth client (Web) trên Google Cloud Console — verify `id_token` + render nút Google; trống → ẩn nút |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | App trên Meta for Developers — App Secret **chỉ ở BE**; trống → ẩn nút Facebook |
| `SMTP_USER`, `SMTP_PASSWORD` | **Không còn bắt buộc ở v5** — không còn luồng gửi OTP qua email; chỉ giữ nếu sau này bật email thông báo |

**Việc chủ đồ án phải tự làm:** đặt `JWT_SECRET` trong `.env`; tạo OAuth client trên Google Cloud Console (khai origin `http://localhost:3000`); tạo app + sản phẩm Facebook Login trên Meta for Developers; mở PR từ fork vào repo chính và nhờ chủ repo merge. (So với v4: **không còn phải tạo Gmail App Password**.)

## C4. Cách chạy

```bash
git clone -b develop https://github.com/linh1912/DAFL.git   # hoặc repo chính sau khi PR được merge
cd DAFL
cp .env.example .env        # điền JWT_SECRET và các khóa thật nếu cần (hoặc để trống để chạy chế độ mock/dev)
docker compose up --build   # FE: http://localhost:3000 · BE: http://localhost:5000 (Swagger ở môi trường Development)
```

Lưu ý: vì DB dùng `EnsureCreated` (không migration), **sau mỗi đợt đổi schema phải tạo lại DB dev**: `docker compose down -v` rồi `up` lại — dữ liệu seed tự sinh lại.
Chạy kiểu dev (không Docker cho code): `docker compose up postgres kafka -d`, rồi `dotnet run` trong `src/Backend` và `npm install && npm run dev` trong `src/Frontend` (trang dev ở :5173, đã cấu hình proxy sang BE).

---

# PHẦN D — HỆ THỐNG KIỂM THỬ (REPO 2) & QUALITY GATE

- **Selenium (Java 17 + Selenium 4.33 + TestNG 7.11 + Allure):** mô hình **POM 3 lớp** — `pageUIs` (locator bám `data-testid`), `pageObjects` (hành động/kiểm chứng), `commons` (`BasePage`, `BaseTest` có helper `loginWithDemoAccount()`, `randomEmail()`, chụp màn hình khi fail đính vào Allure). WebDriver giữ bằng ThreadLocal; chạy headless trong container Maven+Chrome khi qua Jenkins.
- **Cập nhật bộ test theo v5 (CN-01..CN-08):** `AuthTest` bỏ bước OTP khi đăng ký (đăng ký xong đăng nhập ngay) và sửa câu assert lỗi đăng nhập; `CartManagementTest` bỏ đăng nhập trước khi thêm giỏ, thêm test **gộp giỏ sau đăng nhập**; `CatalogAndSearchTest` thêm phân trang 12/trang, sắp xếp, khoảng giá; `CheckoutAndOrderTest` cập nhật kỳ vọng chuyển hướng đăng nhập, assert mã đơn dạng DH và trạng thái Chờ xác nhận; `EndToEndShoppingFlowTest` đổi sang luồng khách → gộp giỏ → đặt COD; thêm 2 class mới `ProfileAndAddressTest` (CN-03) và `OrderCancellationTest` (CN-08); `SocialLoginTest` (phần mở rộng) giữ nguyên, chỉ đổi điểm assert sang phiên JWT. Các test cũ thuộc luồng đã bỏ (cổng thêm giỏ, OTP, khóa mềm, quên mật khẩu) bị loại khỏi bộ chuẩn. *(Lưu ý trình bày khi bảo vệ: số lượng test case cần thống nhất theo code sau khi cập nhật — README repo 2 và các tài liệu cũ từng ghi các con số khác nhau.)*
- **JMeter:** kịch bản hiệu năng lấy JWT ở bước setup (đăng nhập một lần) rồi truyền `Authorization: Bearer` cho các request cần xác thực (thay cho Cookie Manager giữ phiên `sid` của các bản trước); 2 thread group (luồng mua hàng chính + luồng phụ trợ).
- **2 Quality Gate (cốt lõi đề tài):**
  1. *Cổng chức năng:* **bất kỳ** test Selenium nào FAIL/ERROR → pipeline FAIL, không deploy (quét XML Surefire).
  2. *Cổng hiệu năng:* error rate **≤ 2%** và thời gian phản hồi trung bình **≤ 1000 ms** (script đọc file `.jtl` của JMeter).
- **Jenkins (JCasC — cấu hình bằng code):** dựng bằng Docker Compose trong `ci/jenkins/quick-setup`, tự sinh 3 job: `DAFL-Pipeline` (tổng hợp: checkout → dựng SUT → Selenium → gate chức năng → JMeter → gate hiệu năng → deploy → verify), `DAFL-Automation` (chỉ chức năng), `DAFL-Performance` (chỉ hiệu năng). Trigger `githubPush()`, timeout 30 phút, giữ 10 build gần nhất.

---

# PHẦN E — TRẠNG THÁI TRIỂN KHAI THEO ĐỢT

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| Gốc | FE/BE đầy đủ luồng mua hàng cơ bản, PayOS, Kafka/SignalR, repo 2 (Selenium/JMeter/Jenkins/Gate) | Đã có |
| v3 | Cổng thêm giỏ, đăng ký + OTP cứng, khóa mềm, quên mật khẩu OTP, reskin mỹ phẩm (BE 107/107 test, FE 63/63 test) | Đã code + đẩy lên fork `linh1912/DAFL` (commit `eefaefd`), chờ PR merge vào repo chính |
| v3.1 | Bỏ đăng nhập OTP + nút demo, chuẩn validate inline đỏ, checklist mật khẩu 2×2, SMTP Gmail qua `.env` + `debugCode` ở dev | Đã code |
| v4 | Social login Google/Facebook (+ mock test), thông tin giao hàng cấu trúc + sổ địa chỉ + snapshot đơn, cập nhật bộ test repo 2 | Đã chốt đặc tả; triển khai một phần (FE đã có social + form giao hàng) |
| **v5** | **Viết lại theo đặc tả CN-01..CN-08 + override O1/O2/O3:** JWT 1 giờ thay cookie phiên; giỏ khách + gộp giỏ + giỏ server; đăng ký không OTP (policy mật khẩu nghiêm ngặt giữ nguyên); sổ địa chỉ tối đa 5; mã đơn DH{yyyyMMdd}-{NNNN}; vòng đời đơn CN + hủy đơn hoàn tồn kho; voucher kiểm tra lại khi đặt hàng; bỏ cổng thêm giỏ/quên mật khẩu/khóa mềm/yêu thích/đánh giá | Đã chốt đặc tả (bản chốt v5) — triển khai code BE/FE + cập nhật repo 2 theo Mục 13–14 của bản chốt |

**Tài liệu liên quan:** `LUONG-NGHIEP-VU-DAFL-BAN-CHOT.md` (đặc tả nghiệp vụ v5 — nguồn sự thật duy nhất cho nghiệp vụ), `DAC-TA-CN-01-08.md` (đặc tả CN gốc + override đã chốt), `MO-TA-DAFL-v4.md` (bản mô tả trước, giữ để đối chiếu), `THIET-KE-NGHIEP-VU-MOI-DAFL.md` (lịch sử thiết kế), `MO-TA-DAFL-2-REPO.md` (mô tả chi tiết theo code ở trạng thái gốc).
