# ĐẶC TẢ CHUẨN DAFL — CN-01..CN-08 (Daniel chốt 2026-11-01)

Đây là nguồn sự thật DUY NHẤT cho vòng làm lại hiện tại. Nội dung CN do Daniel cung cấp nguyên văn (tóm lược giữ nguyên quy tắc/thông điệp), cộng các OVERRIDE Daniel chốt sau đó.

## OVERRIDE của Daniel (quan trọng hơn CN gốc)
- **O1 — Thanh toán / phí ship / voucher: GIỮ NGUYÊN như app hiện tại.** COD + PayOS đều giữ; phí ship 25.000đ, miễn phí khi tạm tính ≥ 299.000đ (KHÔNG đổi sang 30.000đ/500.000đ của CN); **voucher/mã giảm giá GIỮ và phải làm kỹ**: backend kiểm tra lại mã khi đặt hàng (tồn tại, còn hiệu lực/hạn, đạt mức đơn tối thiểu, giới hạn lượt dùng), thông báo lỗi rõ ràng từng trường hợp, đơn hàng lưu mã voucher + số tiền được giảm, tổng tiền hiển thị tách dòng giảm giá.
- **O2 — Quy tắc mật khẩu: GIỮ NGUYÊN policy nghiêm ngặt như bản v3** (Daniel đính chính 2026-11-01): tối thiểu 8 ký tự + ít nhất 1 chữ hoa + ít nhất 1 chữ số + ít nhất 1 ký tự đặc biệt, ở đăng ký/đổi mật khẩu/đặt mật khẩu. (Câu chữ thông báo lỗi mật khẩu của CN-01 bên dưới KHÔNG áp dụng; dùng thông điệp theo policy hiện hành.)
- **O3 — Social login Google/Facebook: GIỮ** theo yêu cầu trước của Daniel (thiết kế ở bản v4: FE lấy token → BE verify với nhà cung cấp; mock ở Development/Testing cho Selenium; quy tắc liên kết L1–L5). Tài khoản social được coi là đã xác thực email.
- Ngoài 3 override trên: làm đúng CN-01..CN-08. Hệ quả: **bỏ** cổng đăng nhập ở bước thêm giỏ, **bỏ** xác thực OTP khi đăng ký, **bỏ** quên mật khẩu, **bỏ** khóa mềm tài khoản, **bỏ** yêu thích/đánh giá nếu có trong UI, đăng nhập chuyển từ cookie `sid` sang **JWT hạn 1 giờ**.

## CN-01. Đăng ký
- Tác nhân: khách chưa có tài khoản, chưa đăng nhập. Hậu điều kiện: tài khoản mới được tạo, mật khẩu mã hóa bcrypt, vai trò customer.
- Luồng chính: bấm "Đăng ký" ở header → form: họ tên, email, SĐT, mật khẩu, xác nhận mật khẩu → kiểm tra dữ liệu + kiểm tra email và SĐT chưa tồn tại → mã hóa mật khẩu, lưu tài khoản → hiện "Đăng ký thành công", chuyển sang trang đăng nhập. (KHÔNG có bước OTP.)
- Quy tắc + thông báo lỗi (đúng câu chữ):
  - Họ tên: bắt buộc, 2–50 ký tự → "Họ tên không hợp lệ"
  - Email: bắt buộc, đúng định dạng, duy nhất → "Email không hợp lệ" / "Email đã được sử dụng"
  - SĐT: bắt buộc, 10 số bắt đầu bằng 0, duy nhất → "Số điện thoại không hợp lệ" / "Số điện thoại đã được sử dụng"
  - Mật khẩu: tối thiểu 8 ký tự, có chữ và số → "Mật khẩu tối thiểu 8 ký tự, gồm chữ và số"
  - Xác nhận mật khẩu: trùng mật khẩu → "Mật khẩu xác nhận không khớp"
- Ngoại lệ: E1 trống trường bắt buộc → lỗi ngay tại ô, không gửi form. E2 email/SĐT trùng → báo lỗi, giữ nguyên dữ liệu đã nhập (trừ mật khẩu). E3 lỗi server → "Có lỗi xảy ra, vui lòng thử lại".

## CN-02. Đăng nhập / Đăng xuất
- Đăng nhập: nhập email + mật khẩu → kiểm tra email tồn tại và mật khẩu khớp bản mã hóa → tạo **JWT hạn 1 giờ** trả client → client lưu token, chuyển về trang trước đó (hoặc trang chủ) → header hiện tên người dùng + menu tài khoản. Nếu có giỏ tạm (chưa đăng nhập) → gộp vào giỏ tài khoản (CN-06.4).
- Đăng xuất: xóa token, về trang chủ, header về trạng thái chưa đăng nhập.
- Ngoại lệ: E1 sai email/mật khẩu → "Email hoặc mật khẩu không đúng" (không nêu rõ sai cái nào — thay cho câu chữ cũ). E2 trống trường → lỗi tại ô. E3 token hết hạn khi đang thao tác → chuyển về đăng nhập kèm "Phiên đăng nhập đã hết hạn". E4 vào trang cần đăng nhập (thanh toán, đơn hàng, hồ sơ) khi chưa đăng nhập → chuyển đăng nhập, xong quay lại đúng trang đó.

## CN-03. Quản lý thông tin cá nhân
- 3.1 Xem/sửa hồ sơ: hiển thị họ tên, email, SĐT; sửa được họ tên + SĐT (validate như CN-01, SĐT trùng tài khoản khác → lỗi); email chỉ hiển thị, không sửa. Thành công → "Cập nhật thành công".
- 3.2 Đổi mật khẩu: mật khẩu hiện tại + mới + xác nhận mới. Kiểm tra: mật khẩu hiện tại đúng ("Mật khẩu hiện tại không đúng"), mật khẩu mới đạt quy tắc O2 và khác mật khẩu cũ (trùng → báo lỗi).
- 3.3 Sổ địa chỉ: thêm địa chỉ gồm tên người nhận, SĐT, tỉnh/thành, quận/huyện, phường/xã, địa chỉ cụ thể. Sửa/xóa được; tối đa **5** địa chỉ; địa chỉ đầu tiên tự động là mặc định; xóa địa chỉ mặc định → địa chỉ còn lại gần nhất lên thay; đơn hàng lưu BẢN SAO địa chỉ (snapshot — cách được khuyến nghị, đã áp dụng).

## CN-04. Danh sách / tìm kiếm / lọc sản phẩm (không cần đăng nhập)
- Phân trang **12 sản phẩm/trang**. Thẻ sản phẩm: ảnh, tên, giá (giá khuyến mãi nếu có), nhãn "Hết hàng" khi tồn kho = 0.
- Kết hợp được: tìm theo từ khóa trong tên (không phân biệt hoa thường); lọc danh mục; lọc khoảng giá (từ–đến); sắp xếp: mới nhất (mặc định), giá tăng dần, giá giảm dần. Giữ bộ lọc khi chuyển trang.
- Ngoại lệ: E1 không có kết quả → "Không tìm thấy sản phẩm phù hợp" + nút "Xóa bộ lọc". E2 giá từ > giá đến → báo lỗi, không lọc. E3 từ khóa ký tự đặc biệt/mã độc → xử lý như chuỗi thường (chống SQLi/XSS).
- Quy tắc: sản phẩm ngừng bán không hiển thị; hết hàng vẫn hiển thị nhưng không cho thêm giỏ.

## CN-05. Chi tiết sản phẩm (không cần đăng nhập)
- Hiển thị: bộ ảnh, tên, mã sản phẩm, giá gốc/giá khuyến mãi, mô tả, tồn kho, biến thể (size/màu nếu có). Chọn biến thể + số lượng (mặc định 1). "Thêm vào giỏ" → CN-06; "Mua ngay" → thêm giỏ rồi sang thẳng thanh toán CN-07.
- Quy tắc: số lượng nguyên, 1 ≤ SL ≤ tồn kho biến thể; biến thể hết hàng bị làm mờ/không chọn được; nút mua khóa khi hết hàng.
- Ngoại lệ: E1 sản phẩm không tồn tại/ngừng bán → trang "404 - Không tìm thấy sản phẩm". E2 SL ≤ 0/chữ/vượt tồn kho → báo lỗi, tự về giá trị hợp lệ.

## CN-06. Giỏ hàng (khách chưa hoặc đã đăng nhập)
- 6.1 Thêm vào giỏ: từ CN-05 hoặc thẻ sản phẩm (biến thể mặc định). Kiểm tra tồn kho; trùng biến thể → cộng dồn; chưa có → dòng mới. Cập nhật badge giỏ, thông báo "Đã thêm vào giỏ hàng". Cộng dồn vượt tồn kho → chỉ thêm đến tối đa, báo "Chỉ còn X sản phẩm".
- 6.2 Xem giỏ: mỗi dòng ảnh, tên, biến thể, đơn giá, số lượng, thành tiền; cuối giỏ: tạm tính + nút "Thanh toán". Giỏ trống → "Giỏ hàng trống" + nút "Tiếp tục mua sắm", ẩn nút thanh toán.
- 6.3 Sửa SL/xóa: +/- hoặc nhập số → kiểm tra tồn kho, tính lại ngay. Giảm về 0 hoặc bấm "Xóa" → hỏi xác nhận rồi xóa. Vượt tồn kho → đặt về tối đa + báo "Chỉ còn X sản phẩm".
- 6.4 Lưu giỏ và gộp giỏ: chưa đăng nhập → giỏ ở **localStorage**; đã đăng nhập → giỏ **trên server theo tài khoản**, giữ qua đăng xuất/đăng nhập lại. Khi đăng nhập: gộp giỏ tạm vào giỏ tài khoản, trùng thì cộng dồn (không vượt tồn kho).
- 6.5 Đồng bộ giá/tồn kho: mỗi lần mở giỏ lấy lại giá + tồn kho mới nhất; thay đổi → cập nhật + thông báo; sản phẩm ngừng bán/hết hàng → đánh dấu, không cho thanh toán dòng đó.

## CN-07. Đặt hàng (COD + PayOS theo O1)
- Tiền điều kiện: đã đăng nhập (chưa đăng nhập → chuyển đăng nhập trước, xong quay lại), giỏ có ≥ 1 sản phẩm hợp lệ, đã có ≥ 1 địa chỉ giao hàng.
- Luồng chính: kiểm tra lại từng sản phẩm (còn bán, đủ tồn kho, giá hiện tại). Trang thanh toán hiển thị: địa chỉ giao hàng (mặc định, đổi được/thêm mới), danh sách sản phẩm, phương thức thanh toán (COD; PayOS theo O1), ghi chú đơn (tùy chọn, tối đa 200 ký tự). Tính tiền: Tạm tính = Σ(đơn giá × SL); Phí ship theo O1 (25.000đ, miễn phí ≥ 299.000đ); Voucher theo O1; Tổng = Tạm tính − Giảm giá + Phí ship. Bấm "Đặt hàng" → trong MỘT transaction: kiểm tra tồn kho lần cuối → tạo đơn (mã duy nhất dạng **DH20261101-0001**) + chi tiết đơn (giá tại thời điểm mua + bản sao địa chỉ) → trừ tồn kho → xóa sản phẩm đã đặt khỏi giỏ → trạng thái **Chờ xác nhận** → trang "Đặt hàng thành công" (mã đơn, tổng tiền, địa chỉ, nút "Xem đơn hàng" / "Tiếp tục mua sắm").
- Ngoại lệ: E1 sản phẩm hết/không đủ ở bước kiểm tra → không tạo đơn, rollback, báo rõ sản phẩm nào, đưa về giỏ. E2 giá thay đổi → hiển thị giá mới, yêu cầu xác nhận lại. E3 chưa có địa chỉ → yêu cầu thêm, không cho đặt. E4 hai khách mua món cuối → transaction đảm bảo 1 người thành công. E5 double click "Đặt hàng" → chỉ tạo 1 đơn (khóa nút / mã chống trùng). E6 lỗi hệ thống giữa chừng → rollback, không mất giỏ, không trừ tồn kho.

## CN-08. Xem và hủy đơn hàng (đã đăng nhập)
- 8.1 Danh sách đơn của chính khách, mới nhất trước, phân trang, lọc theo trạng thái. Mỗi dòng: mã đơn, ngày đặt, tổng tiền, trạng thái. Chưa có đơn → "Bạn chưa có đơn hàng nào" + nút mua sắm.
- 8.2 Chi tiết đơn: mã, ngày, trạng thái, sản phẩm (ảnh, tên, biến thể, giá, SL), địa chỉ nhận, phương thức thanh toán, phí ship, tổng tiền, lịch sử mốc trạng thái. Đơn của người khác (sửa URL) → "Không có quyền truy cập" hoặc 404.
- Vòng đời trạng thái: **Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao**; nhánh phụ: Chờ xác nhận → **Đã hủy**. (Chuyển trạng thái từ Đang chuẩn bị trở đi do admin/dữ liệu giả lập.)
- 8.3 Hủy đơn: tại chi tiết đơn, hộp thoại chọn/nhập lý do → xác nhận. Kiểm tra đơn thuộc về khách + đang Chờ xác nhận. Transaction: trạng thái → Đã hủy, lưu lý do + thời điểm hủy, hoàn tồn kho từng dòng. Thông báo "Hủy đơn thành công". Chỉ hủy được ở Chờ xác nhận; từ Đang chuẩn bị trở đi ẩn/khóa nút hủy + hiện "Vui lòng liên hệ hỗ trợ".
- Ngoại lệ: E1 trạng thái đã đổi giữa lúc mở trang và bấm hủy → từ chối "Đơn không còn có thể hủy" + tải lại trạng thái mới. E2 hủy đơn đã hủy → không làm lại, không hoàn tồn kho lần hai. E3 hủy đơn người khác → từ chối quyền.
