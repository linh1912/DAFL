using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Infrastructure.Data;

public static class DbInitializer
{
    private static readonly (string CatSlug, string Name, string Slug, string Desc, decimal Price, decimal? OrigPrice, int Stock, string Img, double Rating, int RevCount)[] SeedProductTemplates =
    {
        ("gia-dung", "Nồi chiên không dầu điện tử 6.5L", "noi-chien-khong-dau-6-5l", "Công nghệ Rapid Air giảm 80% dầu mỡ, màn hình cảm ứng LED hiện đại, công suất 1800W, lòng nồi phủ ceramic chống dính an toàn.", 1250000m, 1650000m, 50, "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600", 4.8, 14),
        ("gia-dung", "Robot hút bụi lau nhà thông minh", "robot-hut-bui-lau-nha-thong-minh", "Lực hút 4000Pa mạnh mẽ, cảm biến LiDAR vẽ bản đồ 3D chính xác, tự động quay về trạm sạc và giặt sấy giẻ lau.", 5990000m, 7500000m, 25, "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600", 4.9, 32),
        ("gia-dung", "Máy lọc không khí ion âm 45m2", "may-loc-khong-khi-ion-am", "Bộ lọc HEPA H13 lọc sạch 99.97% bụi mịn PM2.5, khử mùi hôi thú cưng và vi khuẩn gây dị ứng, hoạt động êm ái 25dB.", 2450000m, 3100000m, 40, "https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600", 4.7, 19),
        ("gia-dung", "Bàn là hơi nước đứng công suất 2000W", "ban-la-hoi-nuoc-dung-2000w", "Ủi phẳng nếp nhăn nhanh chóng trên mọi loại vải, bình chứa nước 1.8L ủi liên tục 60 phút, kèm giá treo đồ tiện lợi.", 890000m, 1200000m, 60, "https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=600", 4.6, 25),
        ("do-an-kho", "Hạt điều rang muối Bình Phước loại A 500g", "hat-dieu-rang-muoi-500g", "Hạt điều nguyên hạt giòn béo ngậy, rang củi tự nhiên giữ trọn hương vị đặc sản Bình Phước, đóng hộp hút chân không cao cấp.", 145000m, 180000m, 120, "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600", 4.9, 65),
        ("do-an-kho", "Mực cán tẩm gia vị Nha Trang hũ 300g", "muc-can-tam-gia-vi-nha-trang", "Mực câu tươi ngon cán mỏng tẩm ớt tỏi đậm đà, vị cay ngọt hài hòa chuẩn vị biển miền Trung ăn vặt hoặc nhâm nhi cực thích.", 125000m, 160000m, 90, "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=600", 4.8, 41),
        ("do-an-kho", "Hạnh nhân sấy mộc nguyên vị Úc 500g", "hanh-nhan-say-moc-uc-500g", "Hạt hạnh nhân nhập khẩu Úc giàu Omega-3 và vitamin E, sấy mộc không tẩm ướp gia vị, thích hợp cho người ăn kiêng Keto và mẹ bầu.", 195000m, 240000m, 85, "https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=600", 4.9, 53),
        ("do-an-kho", "Rong biển cháy tỏi ớt giòn rụm hũ 250g", "rong-bien-chay-toi-ot-250g", "Rong biển mè rang giòn tan thơm lừng mùi tỏi phi giòn, gia vị vừa miệng dùng ăn trực tiếp hoặc trộn cơm rất ngon.", 65000m, 85000m, 150, "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600", 4.7, 37),
        ("quan-ao", "Áo Polo Nam Cotton Pique Cao Cấp", "ao-polo-nam-cotton-pique", "Vải sợi Cotton chải kỹ co giãn 4 chiều, thấm hút mồ hôi tối ưu, form Regular vừa vặn sang trọng cho cả đi làm và đi chơi.", 289000m, 350000m, 80, "https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?w=600", 4.6, 22),
        ("quan-ao", "Quần Jean Nam ống đứng co giãn chống nhăn", "quan-jean-nam-ong-dung", "Chất liệu Denim pha sợi Spandex co giãn nhẹ, giữ form bền bỉ sau nhiều lần giặt, đường may tỉ mỉ sắc nét tôn dáng.", 380000m, 480000m, 65, "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600", 4.8, 45),
        ("quan-ao", "Đầm xòe hoa nhí phong cách vintage mùa hè", "dam-xoe-hoa-nhi-vintage", "Chất vải voan tơ mềm mại thoáng mát, họa tiết hoa nhí nữ tính nhẹ nhàng, thiết kế chiết eo tôn dáng thon gọn.", 295000m, 390000m, 50, "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600", 4.9, 33),
        ("quan-ao", "Áo khoác gió thể thao 2 lớp chống nước", "ao-khoac-gio-the-thao-chong-nuoc", "Vải tráng màng PU kháng nước và cản gió hiệu quả, lót lưới thông thoáng không bí bách, khóa kéo YKK chắc chắn.", 320000m, 420000m, 75, "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600", 4.7, 29),
        ("trang-suc", "Dây chuyền bạc Ý 925 đính đá pha lê Swarovski", "day-chuyen-bac-y-925-swarovski", "Bạc nguyên chất chuẩn quốc tế sáng bóng chống xỉn màu, mặt dây nạm đá pha lê lấp lánh tinh xảo, kèm hộp đựng quà cao cấp.", 450000m, 600000m, 40, "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600", 4.9, 38),
        ("trang-suc", "Nhẫn bạc đôi đính đá khắc chữ tình yêu", "nhan-bac-doi-khac-chu", "Cặp nhẫn bạc cao cấp thiết kế hở điều chỉnh kích cỡ linh hoạt, đính đá Zirconia nhân tạo sáng trong thuần khiết.", 320000m, 450000m, 55, "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=600", 4.8, 47),
        ("trang-suc", "Lắc tay nữ mạ vàng hồng 18K thiết kế cỏ 4 lá", "lac-tay-nu-co-4-la-vang-hong", "Biểu tượng may mắn đính đá xà cừ tự nhiên sang trọng, công nghệ mạ chân không PVD bền màu không lo bay màu.", 280000m, 380000m, 60, "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600", 4.7, 26),
        ("trang-suc", "Bông tai ngọc trai nhân tạo cao cấp", "bong-tai-ngoc-trai-cao-cap", "Ngọc trai tròn đều bóng bẩy, chuôi bạc 925 an toàn tuyệt đối không gây kích ứng cho làn da nhạy cảm.", 190000m, 260000m, 70, "https://images.unsplash.com/photo-1630019852942-f89202989a59?w=600", 4.8, 19),
        ("ca-phe", "Cà phê Robusta Honey Lâm Đồng 500g", "ca-phe-robusta-honey-500g", "Hương thơm đậm đà, vị đắng dịu hậu ngọt caramel tự nhiên, rang mộc 100% từ nông trại Cầu Đất Đà Lạt.", 165000m, 200000m, 100, "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600", 4.9, 28),
        ("ca-phe", "Cà phê Arabica Cầu Đất nguyên hạt rang vừa 500g", "ca-phe-arabica-cau-dat-500g", "Hương thơm trái cây cam chanh nhẹ nhàng, vị chua thanh tinh tế, chuẩn cà phê đặc sản Specialty Coffee Việt Nam.", 195000m, 250000m, 90, "https://images.unsplash.com/photo-1587734195503-904fca47e0e9?w=600", 5, 44),
        ("ca-phe", "Ấm pha cà phê Moka Pot inox phong cách Ý", "am-pha-ca-phe-moka-pot-inox", "Chất liệu Inox 304 không gỉ dùng được trên cả bếp từ và bếp gas, chiết xuất cà phê đậm đặc tạo lớp crema vàng óng.", 290000m, 380000m, 45, "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600", 4.7, 31),
        ("ca-phe", "Máy xay cà phê cầm tay cối gốm đa cấp độ", "may-xay-ca-phe-cam-tay-coi-gom", "Lưỡi nghiền gốm Ceramic không làm nóng cà phê khi xay, chỉnh độ mịn dễ dàng cho pha phin, espresso hay Pour-Over.", 210000m, 290000m, 60, "https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600", 4.8, 23),
        ("ca-canh", "Bể cá mini để bàn thủy sinh kèm đèn LED", "be-ca-mini-thuy-sinh-led", "Kích thước 30x15x20cm kính siêu trong, tích hợp lọc thác êm ái và đèn LED 3 chế độ sáng phong thủy.", 450000m, 550000m, 30, "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?w=600", 4.7, 9),
        ("ca-canh", "Bộ lọc thác nước hồ cá mini êm ái chống ồn", "bo-loc-thac-nuoc-ho-ca-mini", "Lưu lượng nước 250L/h tuần hoàn lọc sạch cặn bẩn và tạo oxy tự nhiên, siêu tiết kiệm điện năng chỉ 3W.", 115000m, 150000m, 80, "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?w=600", 4.6, 17),
        ("ca-canh", "Đèn LED hồ thủy sinh 3 chế độ màu kích rêu", "den-led-ho-thuy-sinh-3-che-do", "Hạt LED 5730 siêu sáng tiết kiệm điện, giúp cây thủy sinh quang hợp xanh tốt và cá cảnh lên màu rực rỡ.", 175000m, 230000m, 65, "https://images.unsplash.com/photo-1520315342629-6ea920342047?w=600", 4.8, 24),
        ("ca-canh", "Thức ăn cao cấp cho cá cảnh Tetra Bits 100g", "thuc-an-ca-canh-tetra-bits-100g", "Dạng hạt chìm chậm giàu vitamin và khoáng chất, hỗ trợ cá đĩa, cá thủy sinh lên màu tươi sáng và khỏe mạnh.", 65000m, 85000m, 120, "https://images.unsplash.com/photo-1535591273668-578e31182c4f?w=600", 4.9, 52),
        ("dien-tu", "Tai nghe chống ồn chủ động ANC Pro", "tai-nghe-chong-on-anc-pro", "Pin 40 giờ liên tục, âm thanh Hi-Res Audio sống động, micro lọc gió đàm thoại rõ nét, kết nối Bluetooth 5.3 độ trễ cực thấp.", 890000m, 1200000m, 40, "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600", 4.9, 42),
        ("dien-tu", "Pin sạc dự phòng 20000mAh sạc nhanh 65W", "pin-sac-du-phong-20000mah-65w", "Dung lượng pin thực tế lớn sạc được cả laptop và điện thoại, hỗ trợ công nghệ PD 3.0 và QC 4.0 với màn hình hiển thị LED.", 480000m, 650000m, 55, "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=600", 4.8, 36),
        ("dien-tu", "Củ sạc nhanh GaN 3 cổng 65W Type-C", "cu-sac-nhanh-gan-65w", "Công nghệ bán dẫn GaN thế hệ mới nhỏ gọn và tỏa nhiệt cực thấp, chia nguồn thông minh sạc cùng lúc 3 thiết bị.", 360000m, 490000m, 70, "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600", 4.9, 58),
        ("dien-tu", "Cáp sạc nhanh bọc dù 100W siêu bền 1.5m", "cap-sac-nhanh-boc-du-100w", "Chíp E-Marker điều tiết dòng điện an toàn, dây bọc sợi nylon bện siêu bền chống đứt gãy gập 10.000 lần.", 85000m, 120000m, 150, "https://images.unsplash.com/photo-1616440347437-b1c73416efc2?w=600", 4.7, 67),
        ("may-tinh", "Bàn phím cơ không dây Custom 75%", "ban-phim-co-custom-75", "Switch Gateron Pro êm ái, pin dung lượng cao 4000mAh, kết nối 3 chế độ (Type-C, 2.4Ghz, Bluetooth), led RGB 16.8 triệu màu.", 1590000m, 1950000m, 25, "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600", 5, 18),
        ("may-tinh", "Chuột máy tính công thái học không dây Silent Click", "chuot-cong-thai-hoc-silent-click", "Thiết kế góc nghiêng 57 độ giảm mỏi cổ tay, mắt đọc quang học 4000 DPI siêu nhạy di mượt trên mọi bề mặt, nút bấm êm ái không gây ồn.", 390000m, 520000m, 65, "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600", 4.8, 49),
        ("may-tinh", "Giá đỡ laptop nhôm tản nhiệt 6 nấc chỉnh độ cao", "gia-do-laptop-nhom-tan-nhiet", "Chất liệu hợp kim nhôm đúc nguyên khối chịu lực 10kg, gấp gọn bỏ balo tiện lợi, đệm silicon chống trầy xước máy.", 195000m, 270000m, 90, "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600", 4.9, 83),
        ("may-tinh", "Lót chuột khổ lớn 80x30cm đệm cao su may viền", "lot-chuot-kho-lon-80x30", "Bề mặt vải Speed dệt mịn tối ưu hóa độ chính xác của chuột, đế cao su tự nhiên bám dính bàn chống trơn trượt.", 110000m, 160000m, 110, "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600", 4.7, 41),
        ("my-pham", "Serum cấp ẩm phục hồi da Hyaluronic Acid B5 30ml", "serum-cap-am-phuc-hoi-b5", "Chứa phân tử HA đa tầng thẩm thấu sâu và Vitamin B5 làm dịu da tức thì, phục hồi hàng rào bảo vệ da căng bóng mịn màng.", 285000m, 380000m, 75, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.9, 56),
        ("my-pham", "Kem chống nắng phổ rộng SPF 50+ PA++++ 50ml", "kem-chong-nang-pho-rong-50ml", "Màng lọc chống nắng tiên tiến bảo vệ da khỏi tia UVA/UVB và ánh sáng xanh, nâng tone tự nhiên kiềm dầu suốt 8 giờ.", 260000m, 350000m, 80, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.8, 62),
        ("my-pham", "Son kem lì mịn môi lâu trôi màu đỏ cam đất", "son-kem-li-do-cam-dat", "Chất son velvet xốp mịn lướt êm trên môi không gây khô nứt, lên màu chuẩn sắc tôn da trắng sáng, bền màu 8 tiếng.", 195000m, 260000m, 95, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.9, 77),
        ("my-pham", "Nước tẩy trang dịu nhẹ cho da nhạy cảm 400ml", "nuoc-tay-trang-diu-nhe-400ml", "Công nghệ Micellar Water hút sạch bã nhờn và cặn trang điểm chống nước, chiết xuất rau má làm dịu mát lành cho da.", 180000m, 240000m, 85, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.7, 39),
        ("me-va-be", "Bình sữa cổ rộng chất liệu PPSU chống sặc 240ml", "binh-sua-ppsu-chong-sac-240ml", "Nhựa PPSU phủ thủy tinh chịu nhiệt 180 độ C an toàn không chứa BPA, van thông khí kép ngăn ngừa ợ hơi và sặc sữa.", 220000m, 290000m, 70, "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=600", 4.9, 48),
        ("me-va-be", "Máy tiệt trùng sấy khô và hâm sữa đa năng", "may-tiet-trung-say-kho-ham-sua", "Khử khuẩn bằng hơi nước 360 độ và sấy khô bằng khí nóng tuần hoàn, khoang chứa rộng tiệt trùng cùng lúc 6 bình sữa.", 650000m, 890000m, 35, "https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=600", 4.8, 27),
        ("me-va-be", "Khăn ướt không mùi dịu nhẹ cho bé gói 100 tờ", "khan-uot-khong-mui-cho-be", "Vải không dệt dày dặn mềm mại với 99.9% nước tinh khiết khử ion, không cồn, không paraben chăm sóc làn da non nớt.", 35000m, 48000m, 200, "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=600", 4.9, 92),
        ("me-va-be", "Đồ chơi gặm nướu silicon y tế an toàn cho trẻ", "do-choi-gam-nuou-silicon", "Chất liệu silicon mềm dẻo đạt chuẩn FDA, thiết kế nhiều hạt massage xoa dịu cảm giác ngứa nướu mọc răng ở trẻ nhỏ.", 75000m, 105000m, 110, "https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=600", 4.8, 34),
        ("sach", "Sách Thay Đổi Tí Hon Hiệu Quả Bất Ngờ (Atomic Habits)", "sach-atomic-habits", "Cuốn sách bán chạy toàn cầu của James Clear về phương pháp xây dựng thói quen tốt và từ bỏ thói quen xấu từng bước nhỏ.", 135000m, 189000m, 85, "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600", 5, 89),
        ("sach", "Sách Đắc Nhân Tâm - Nghệ Thuật Ứng Xử Đỉnh Cao", "sach-dac-nhan-tam", "Tác phẩm kinh điển vượt thời gian của Dale Carnegie về thuật thu phục lòng người và xây dựng mối quan hệ bền vững.", 95000m, 130000m, 100, "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600", 4.9, 67),
        ("sach", "Sổ tay bìa da cao cấp A5 giấy kem chống lóa", "so-tay-bia-da-cao-cap-a5", "Bìa da PU dập vân tinh tế, ruột giấy 100gsm chống thấm mực sang trang sau, kèm dây đánh dấu trang và ngăn đựng tài liệu.", 85000m, 120000m, 95, "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=600", 4.8, 43),
        ("sach", "Hộp bút gel mực đen ngòi 0.5mm êm mượt 12 cây", "hop-but-gel-muc-den-12-cay", "Mực gel đậm màu ra đều không tắc mực, ngòi kim loại bền chắc viết êm nhẹ, đệm cao su tay cầm chống trơn mỏi tay.", 55000m, 75000m, 160, "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=600", 4.7, 51),
        ("the-thao", "Thảm tập Yoga định tuyến TPE 8mm chống trượt", "tham-tap-yoga-tpe-8mm", "Vật liệu TPE thân thiện môi trường độ đàn hồi cao bảo vệ xương khớp, vạch định tuyến chuẩn hỗ trợ chuẩn xác từng tư thế.", 245000m, 340000m, 60, "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600", 4.9, 44),
        ("the-thao", "Bộ 5 dây kháng lực tập gym toàn thân đa năng", "bo-5-day-khang-luc-tap-gym", "Cao su thiên nhiên 100% bền bỉ với 5 mức lực từ 10lbs đến 50lbs, rèn luyện cơ bắp linh hoạt tại nhà hoặc khi đi du lịch.", 120000m, 170000m, 85, "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600", 4.8, 39),
        ("the-thao", "Bình nước thể thao giữ nhiệt inox 304 dung tích 1L", "binh-nuoc-the-thao-giu-nhiet-1l", "Giữ lạnh 24 giờ và giữ nóng 12 giờ, nắp bật thể thao kèm ống hút tiện lợi, sơn tĩnh điện nhám bám tay không đọng nước bề mặt.", 165000m, 230000m, 90, "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600", 4.9, 58),
        ("the-thao", "Vợt cầu lông khung carbon siêu nhẹ trợ lực", "vot-cau-long-carbon-sieu-nhe", "Trọng lượng 4U (82g) linh hoạt vung vợt tốc độ, thân dẻo trợ lực phản tạt sắc bén, đan sẵn lưới 10.5kg tặng kèm bao vợt.", 490000m, 680000m, 45, "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=600", 4.7, 28),
        ("giay-dep", "Giày thể thao Sneaker nam nữ chạy bộ siêu nhẹ", "giay-sneaker-chay-bo-sieu-nhe", "Đế đệm khí êm ái giảm chấn thương, thân dệt vải Flyknit thoáng khí ôm chân vừa vặn, phong cách trẻ trung năng động.", 420000m, 590000m, 70, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600", 4.9, 66),
        ("giay-dep", "Giày lười slip-on da bò mềm đế êm công sở", "giay-luoi-slip-on-da-bo", "Chất da bò thật 100% càng đi càng mềm, lót mút cao su non khử mùi êm chân, phù hợp phối quần âu hay kaki lịch lãm.", 550000m, 750000m, 50, "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=600", 4.8, 35),
        ("giay-dep", "Balo thời trang chống thấm nước có ngăn laptop 15.6 inch", "balo-thoi-trang-chong-nuoc", "Chất vải Oxford phủ trượt nước cao cấp, đệm lưng tổ ong thoáng khí êm vai, tích hợp cổng sạc USB tiện dụng khi di chuyển.", 340000m, 480000m, 65, "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600", 4.9, 53),
        ("giay-dep", "Ví nam da bò dáng đứng nhiều ngăn đựng thẻ", "vi-nam-da-bo-dang-dung", "Da sáp dầu sang trọng có khả năng tự mờ vết xước nhẹ, tích hợp lớp lót chống quét trộm thẻ từ RFID an toàn bảo mật.", 210000m, 290000m, 85, "https://images.unsplash.com/photo-1627123424574-724758594e93?w=600", 4.7, 41),
        ("xe-may-oto", "Camera hành trình ô tô góc rộng 4K GPS cảnh báo tốc độ", "camera-hanh-trinh-oto-4k", "Cảm biến Sony Starvis ghi hình ban đêm siêu nét, tích hợp định vị GPS và kết nối Wifi xem trực tiếp trên smartphone.", 1290000m, 1750000m, 35, "https://images.unsplash.com/photo-1508974239320-0a029497e820?w=600", 4.9, 32),
        ("xe-may-oto", "Máy bơm lốp ô tô mini tự ngắt điện tử di động", "may-bom-lop-oto-mini-tu-ngat", "Đo áp suất lốp chính xác và tự ngắt khi đủ áp suất cài đặt, lưu lượng khí 35L/phút bơm căng lốp rỗng chỉ trong 4 phút.", 450000m, 620000m, 55, "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=600", 4.8, 47),
        ("xe-may-oto", "Mũ bảo hiểm 3/4 kính âm thời trang đạt chuẩn CR", "mu-bao-hiem-3-4-kinh-am", "Vỏ nhựa ABS nguyên sinh chịu va đập cực tốt, kính chống chói tia UV gấp gọn bên trong nón, lót kháng khuẩn tháo giặt dễ dàng.", 280000m, 390000m, 70, "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=600", 4.9, 54),
        ("xe-may-oto", "Gối tựa đầu cao su non bọc da cao cấp cho xe hơi", "goi-tua-dau-cao-su-non-xe-hoi", "Thiết kế ôm khít hõm cổ hỗ trợ cột sống giảm nhức mỏi khi lái xe đường dài, vỏ bọc da thông hơi đục lỗ sang trọng.", 160000m, 220000m, 80, "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600", 4.7, 29),
        ("noi-that", "Bàn làm việc chữ Z khung thép chịu lực chống gỉ", "ban-lam-viec-chu-z", "Mặt bàn gỗ MDF phủ melamine chống trầy xước kích thước 120x60cm, chân sắt hộp sơn tĩnh điện chịu tải trọng 150kg.", 650000m, 890000m, 40, "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600", 4.8, 37),
        ("noi-that", "Đèn sàn trang trí góc phòng khách phong cách Bắc Âu", "den-san-trang-tri-bac-au", "Thân kim loại mạ vàng chải xước tinh tế, chao đèn vải lanh khuếch tán ánh sáng vàng ấm dịu mắt, chân đế đá granite vững chãi.", 450000m, 620000m, 35, "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600", 4.9, 25),
        ("noi-that", "Thảm lông cừu trải sàn phòng ngủ mềm mịn 1.6x2m", "tham-long-cuu-trai-san", "Sợi lông dày êm ái chống rụng lông, mặt dưới dập hạt cao su chống trượt tuyệt đối, dễ dàng vệ sinh bằng máy hút bụi.", 290000m, 420000m, 60, "https://images.unsplash.com/photo-1600121848594-d8644e57abab?w=600", 4.7, 31),
        ("noi-that", "Kệ sách đứng gỗ tổ ong 5 tầng tiết kiệm diện tích", "ke-sach-dung-go-to-ong", "Thiết kế ziczac hiện đại tối ưu góc chết phòng ngủ hoặc phòng khách, gỗ công nghiệp lõi xanh chống ẩm bền đẹp.", 380000m, 520000m, 50, "https://images.unsplash.com/photo-1594980596870-8aa52a78d8cd?w=600", 4.8, 29),
        ("am-thanh", "Loa Bluetooth không dây chống nước công suất 20W", "loa-bluetooth-khong-day-20w", "Âm thanh vòm 360 độ với dải bass mạnh mẽ, chuẩn chống nước IPX7 thoải mái mang đi tiệc hồ bơi, pin nghe nhạc 12 giờ.", 690000m, 950000m, 45, "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=600", 4.9, 53),
        ("am-thanh", "Micro thu âm livestream chuyên nghiệp kèm chân kẹp", "micro-thu-am-livestream", "Búp sóng Cardioid tập trung bắt giọng hát và lọc sạch tạp âm xung quanh, cổng kết nối Type-C cắm là nhận tương thích mọi thiết bị.", 420000m, 580000m, 50, "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=600", 4.8, 38),
        ("am-thanh", "Đàn Ukulele gỗ Mahogany 23 inch kèm bao da", "dan-ukulele-go-mahogany-23", "Gỗ gụ nguyên tấm cộng hưởng âm thanh vang trong trẻo, dây Aquila cao cấp mềm tay dễ bấm cho người mới bắt đầu.", 380000m, 500000m, 40, "https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=600", 4.9, 41),
        ("am-thanh", "Tai nghe In-ear Monitor kiểm âm chuyên nghiệp", "tai-nghe-in-ear-monitor-kiem-am", "Cấu hình 1 Dynamic + 1 Balanced Armature tái hiện chi tiết từng dải âm, dây đồng OFC mạ bạc tháo rời chân cắm 2-pin.", 350000m, 480000m, 65, "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600", 4.7, 33),
        ("tra-thao-moc", "Trà Ô Long Tứ Quý thượng hạng hộp thiếc 200g", "tra-o-long-tu-quy-200g", "Búp trà xanh non thu hái sáng sớm tại Bảo Lộc, hương thơm hoa tự nhiên nước trà vàng óng thanh tao ngọt hậu lắng đọng.", 185000m, 240000m, 85, "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600", 4.9, 47),
        ("tra-thao-moc", "Trà hoa cúc La Mã sấy lạnh nguyên bông an thần 100g", "tra-hoa-cuc-la-ma-100g", "Hoa cúc sấy lạnh giữ nguyên tinh dầu thơm dịu, giúp an thần ngủ ngon giấc và thanh nhiệt cơ thể hiệu quả.", 110000m, 150000m, 95, "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?w=600", 4.8, 52),
        ("tra-thao-moc", "Trà gạo lứt đậu đen xạ đen thanh nhiệt túi lọc", "tra-gao-lut-dau-den-xa-den", "Hộp 30 túi lọc kết hợp thảo mộc thiên nhiên hỗ trợ giảm mỡ máu, đẹp da giữ dáng và mát gan giải độc.", 85000m, 120000m, 120, "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=600", 4.9, 63),
        ("tra-thao-moc", "Bình pha trà thủy tinh chịu nhiệt có lõi lọc inox 800ml", "binh-pha-tra-thuy-tinh-800ml", "Thủy tinh Borosilicate cao cấp chịu sốc nhiệt từ -20 đến 150 độ C, lõi lọc inox 304 giữ sạch bã trà tiện dụng.", 140000m, 195000m, 75, "https://images.unsplash.com/photo-1563822249548-9a72b6353cd1?w=600", 4.7, 36),
        ("thuc-pham-chuc-nang", "Viên uống bổ sung Omega 3 dầu cá tinh khiết 1000mg", "vien-uong-omega-3-1000mg", "Dầu cá biển sâu giàu EPA và DHA hỗ trợ sức khỏe tim mạch, cải thiện thị lực và tăng cường tuần hoàn não bộ.", 290000m, 390000m, 65, "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600", 4.9, 58),
        ("thuc-pham-chuc-nang", "Viên sủi Vitamin C 1000mg tăng cường đề kháng", "vien-sui-vitamin-c-1000mg", "Tuýp 20 viên sủi hương cam thanh mát tan nhanh trong nước, bổ sung năng lượng và tăng cường hệ miễn dịch.", 65000m, 90000m, 130, "https://images.unsplash.com/photo-1550572017-4fcdbb59cc32?w=600", 4.8, 74),
        ("thuc-pham-chuc-nang", "Bột Collagen thủy phân làm đẹp da chống lão hóa", "bot-collagen-thuy-phan-chong-lao-hoa", "Hộp 30 gói Collagen Peptide cá biển phân tử siêu nhỏ dễ hấp thu, bổ sung độ ẩm và tăng độ đàn hồi săn chắc cho làn da.", 380000m, 520000m, 50, "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=600", 4.9, 49),
        ("thuc-pham-chuc-nang", "Máy đo huyết áp bắp tay điện tử tự động thông minh", "may-do-huyet-ap-bap-tay-dien-tu", "Màn hình LCD lớn hiển thị rõ nét chỉ số huyết áp và nhịp tim, bộ nhớ lưu 99 kết quả cho 2 người dùng.", 590000m, 800000m, 40, "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600", 4.9, 42),
        ("do-choi", "Bộ xếp hình Lego thành phố tương lai 850 chi tiết", "bo-xep-hinh-lego-thanh-pho", "Nhựa ABS cao cấp an toàn bo tròn góc cạnh, kích thích tư duy logic và trí tưởng tượng không gian của trẻ nhỏ.", 420000m, 580000m, 45, "https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=600", 4.9, 36),
        ("do-choi", "Mô hình siêu anh hùng cử động khớp tỉ lệ 1:10", "mo-hinh-sieu-anh-hung-1-10", "Chất liệu PVC cao cấp sơn tĩnh điện sắc nét từng chi tiết giáp trụ, khớp cử động linh hoạt tạo nhiều dáng chiến đấu.", 260000m, 360000m, 55, "https://images.unsplash.com/photo-1608889175123-8ee362201f81?w=600", 4.8, 27),
        ("do-choi", "Bộ bài boardgame tương tác giải đố tiệc gia đình", "bo-bai-boardgame-tuong-tac", "Trò chơi giải trí vui nhộn cho nhóm 4-10 người, thẻ bài cán màng chống nước bền đẹp kèm sách hướng dẫn chi tiết.", 115000m, 160000m, 80, "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=600", 4.7, 33),
        ("do-choi", "Xe ô tô điều khiển từ xa vượt địa hình 4 bánh", "xe-o-to-dieu-khien-tu-xa-dia-hinh", "Hệ thống giảm xóc lò xo 4 bánh độc lập, tốc độ tối đa 25km/h leo dốc vượt chướng ngại vật dễ dàng, pin sạc chơi 30 phút.", 340000m, 480000m, 50, "https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=600", 4.8, 29),
        ("thu-cung", "Hạt dinh dưỡng cho mèo trưởng thành vị cá ngừ 1.5kg", "hat-dinh-duong-cho-meo-1-5kg", "Giàu protein và Taurine hỗ trợ sáng mắt mượt lông, công thức giảm búi lông và cân bằng khoáng chất ngừa sỏi thận.", 135000m, 180000m, 110, "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600", 4.9, 71),
        ("thu-cung", "Cát vệ sinh đất sét cho mèo vón cục khử mùi 8L", "cat-ve-sinh-dat-set-meo-8l", "Hạt khoáng Bentonite tự nhiên vón cục nhanh trong 3 giây, bổ sung hạt silica khử mùi hương táo thơm dịu không bụi bẩn.", 75000m, 105000m, 140, "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=600", 4.8, 64),
        ("thu-cung", "Bát ăn tự động kèm bình cấp nước chống tràn", "bat-an-tu-dong-kem-binh-nuoc", "Nguyên lý xi-phông tự động tiếp nước khi cạn, khay inox 304 tháo rời dễ chùi rửa chống đen cằm cho thú cưng.", 95000m, 135000m, 90, "https://images.unsplash.com/photo-1535268647677-300dbf3d78d1?w=600", 4.7, 45),
        ("thu-cung", "Nệm ngủ tròn lông xù êm ái cho chó mèo size M", "nem-ngu-tron-long-xu-cho-meo", "Lông nhung dài mềm mịn tạo cảm giác an toàn ấm áp, đệm bông gòn PP đàn hồi tốt không xẹp lún sau giặt.", 160000m, 230000m, 65, "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=600", 4.9, 52),
        ("cay-canh", "Cây Kim Tiền phong thủy để bàn mang tài lộc", "cay-kim-tien-phong-thuy-de-ban", "Cây trồng trong chậu sứ trắng thoát nước tốt, lá xanh bóng mọng nước thanh lọc không khí và mang lại may mắn tài lộc.", 150000m, 200000m, 55, "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=600", 4.9, 38),
        ("cay-canh", "Combo 5 cây sen đá mini mix màu dễ chăm sóc", "combo-5-cay-sen-da-mini", "Tuyển chọn 5 giống sen đá khỏe mạnh rực rỡ, thích hợp trang trí bàn làm việc hoặc ban công nhỏ đón nắng.", 85000m, 120000m, 80, "https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=600", 4.8, 44),
        ("cay-canh", "Kéo cắt tỉa cành cây cảnh mũi nhọn thép SK5", "keo-cat-tia-canh-cay-sk5", "Lưỡi thép SK5 của Nhật sắc bén cắt tỉa cành mượt mà không dập xước vỏ cây, cán bọc cao su cầm êm tay chống trượt.", 90000m, 130000m, 95, "https://images.unsplash.com/photo-1592150621744-aca64f48394a?w=600", 4.7, 32),
        ("cay-canh", "Bình tưới cây áp suất dung tích 2L tiện lợi", "binh-tuoi-cay-ap-suat-2l", "Vòi phun đồng điều chỉnh linh hoạt tia nước từ phun sương đến tia thẳng xa 5m, thân bình nhựa dẻo chống nứt vỡ.", 65000m, 95000m, 110, "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=600", 4.8, 49),
        ("thu-cong-my-nghe", "Nến thơm tinh dầu sáp đậu nành tự nhiên thư giãn", "nen-thom-sap-dau-nanh", "Hũ 200g bấc gỗ nổ lách tách như củi sưởi, tinh dầu nguyên chất hương hoa oải hương và gỗ tuyết tùng thư thái tâm trí.", 145000m, 200000m, 75, "https://images.unsplash.com/photo-1603006905003-be475563bc59?w=600", 4.9, 53),
        ("thu-cong-my-nghe", "Bộ ấm chén trà gốm tử sa Bát Tràng men hỏa biến", "bo-am-chen-gom-tu-sa-bat-trang", "Chế tác thủ công từ làng nghề truyền thống Bát Tràng, màu men hỏa biến độc bản sang trọng gồm 1 ấm và 6 chén trà.", 480000m, 650000m, 30, "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600", 5, 41),
        ("thu-cong-my-nghe", "Tranh thêu tay phong cảnh làng quê khung gỗ", "tranh-theu-tay-phong-canh-lang-que", "Từng đường kim mũi chỉ tỉ mỉ tái hiện nét đẹp thanh bình đồng quê Việt Nam, lồng khung gỗ tự nhiên chống mối mọt.", 350000m, 480000m, 40, "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600", 4.8, 23),
        ("thu-cong-my-nghe", "Hộp quà tặng khăn lụa tơ tằm dệt thủ công cao cấp", "khan-lua-to-tam-thu-cong", "Lụa tơ tằm Vạn Phúc mềm mại mát rượi mùa hè ấm áp mùa đông, đóng gói hộp cứng kèm nơ thích hợp làm quà tặng tri ân.", 290000m, 390000m, 55, "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=600", 4.9, 37),
        ("dong-ho", "Đồng hồ nam dây da phong cách Classic máy Quartz Nhật", "dong-ho-nam-day-da-classic", "Mặt kính Sapphire chống trầy xước, vỏ thép không gỉ 316L, khả năng chống nước 5ATM đi mưa rửa tay thoải mái.", 690000m, 950000m, 40, "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=600", 4.9, 48),
        ("dong-ho", "Smartwatch theo dõi sức khỏe đo nhịp tim SpO2 chống nước", "smartwatch-theo-doi-suc-khoe", "Màn hình AMOLED sắc nét luôn bật Always-on Display, nhận cuộc gọi Bluetooth và hỗ trợ hơn 100 chế độ thể thao chuyên sâu.", 850000m, 1190000m, 45, "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600", 4.8, 61),
        ("dong-ho", "Đồng hồ nữ mặt tròn đính đá viền rose gold thanh lịch", "dong-ho-nu-mat-tron-dinh-da", "Mặt số xà cừ óng ánh dưới ánh sáng, dây kim loại dạng lắc tay duyên dáng tôn vinh cổ tay phái đẹp.", 480000m, 650000m, 50, "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=600", 4.9, 39),
        ("dong-ho", "Hộp xoay đồng hồ cơ tự động tích hợp đèn LED trang trí", "hop-xoay-dong-ho-co-tu-dong", "Động cơ Mabuchi Nhật Bản siêu êm ái không tiếng ồn, tự động đảo chiều nạp cót chuẩn xác cho đồng hồ Automatic.", 950000m, 1350000m, 25, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.9, 27),
        ("do-bep", "Bộ 5 dao làm bếp thép không gỉ nguyên khối sắc bén", "bo-5-dao-lam-bep-nguyen-khoi", "Lưỡi thép Đức tôi luyện nhiệt độ cao sắc bén lâu cùn, cán dao đúc liền khối cân bằng lực chặt thái chuẩn xác.", 450000m, 620000m, 55, "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=600", 4.8, 46),
        ("do-bep", "Máy đánh trứng trộn bột cầm tay 7 tốc độ 300W", "may-danh-trung-cam-tay-7-toc-do", "Đi kèm 2 que đánh trứng và 2 que trộn bột inox không gỉ, động cơ đồng nguyên chất bền bỉ hỗ trợ làm bánh bông lan tơi xốp.", 180000m, 250000m, 70, "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600", 4.7, 34),
        ("do-bep", "Bộ khuôn làm bánh chống dính đa năng 6 món", "bo-khuon-lam-banh-chong-dinh", "Gồm khuôn tròn đế rời, khuôn bánh mì, khuôn cupcake phủ lớp chống dính Teflon an toàn dễ dàng lấy bánh nguyên vẹn.", 165000m, 230000m, 60, "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600", 4.9, 41),
        ("do-bep", "Cân tiểu ly điện tử nhà bếp độ chính xác 0.1g", "can-tieu-ly-dien-tu-nha-bep", "Mặt cân inox 304 có chức năng trừ bì tiện lợi, đo lường chuẩn xác từ 0.1g đến 3000g cho pha chế và nướng bánh.", 95000m, 135000m, 120, "https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=600", 4.8, 59),
        ("du-lich", "Vali kéo du lịch khung nhôm khóa số TSA size 20 inch", "vali-keo-khung-nhom-tsa-20", "Chất liệu nhựa PC/ABS đàn hồi chống bể vỡ, 4 bánh xe đôi xoay 360 độ êm ái, khóa số chuẩn hải quan quốc tế TSA an toàn.", 790000m, 1100000m, 35, "https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?w=600", 4.9, 51),
        ("du-lich", "Gối chữ U cao su non đỡ cổ giảm mệt mỏi trên máy bay", "goi-chu-u-cao-su-non-du-lich", "Thiết kế nâng đỡ 360 độ bảo vệ đốt sống cổ, vỏ bọc vải cotton thoáng mát có thể tháo rời giặt sạch dễ dàng.", 125000m, 180000m, 85, "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600", 4.8, 43),
        ("du-lich", "Túi đựng mỹ phẩm đồ cá nhân du lịch nhiều ngăn chống nước", "tui-dung-my-pham-du-lich", "Chất vải Polyester tráng màng kháng nước, có móc treo tường tiện lợi khi vào khách sạn, nhiều ngăn lưới phân loại khoa học.", 85000m, 120000m, 110, "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600", 4.9, 67),
        ("du-lich", "Ổ cắm điện đa năng du lịch quốc tế chuyển đổi 150 quốc gia", "o-cam-dien-da-nang-du-lich", "Tích hợp 4 loại phích cắm chuẩn US, EU, UK, AU cùng 3 cổng sạc USB và 1 cổng Type-C sạc nhanh an toàn.", 140000m, 195000m, 95, "https://images.unsplash.com/photo-1563770660941-20978e870e26?w=600", 4.8, 55),
        ("smart-home", "Khóa cửa thông minh vân tay mật mã thẻ từ tích hợp chuông", "khoa-cua-thong-minh-van-tay", "5 phương thức mở khóa (vân tay sinh trắc học FPC, mật mã ảo, thẻ từ, chìa cơ, app điện thoại), cảnh báo đột nhập chống cạy cửa.", 2450000m, 3500000m, 25, "https://images.unsplash.com/photo-1558002038-1055907df827?w=600", 4.9, 33),
        ("smart-home", "Công tắc cảm ứng thông minh WiFi kết nối Tuya Smart Life", "cong-tac-cam-ung-wifi-tuya", "Mặt kính cường lực chống xước sang trọng, bật tắt hẹn giờ từ xa qua điện thoại hoặc ra lệnh giọng nói qua Google Assistant / Alexa.", 210000m, 290000m, 75, "https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=600", 4.8, 49),
        ("smart-home", "Bóng đèn LED thông minh RGB đổi 16 triệu màu theo nhạc", "bong-den-led-thong-minh-rgb", "Đuôi xoáy E27 tiêu chuẩn, điều chỉnh độ sáng và nhiệt độ màu linh hoạt, nhấp nháy đồng bộ theo giai điệu bài hát cực chill.", 165000m, 230000m, 90, "https://images.unsplash.com/photo-1550985543-f47f38aeee65?w=600", 4.9, 57),
        ("smart-home", "Cảm biến nhiệt độ độ ẩm không dây hiển thị màn hình LCD", "cam-bien-nhiet-do-do-am-lcd", "Màn hình điện tử sắc nét cập nhật thời gian thực, liên kết tự động bật máy điều hòa hoặc máy hút ẩm khi nhiệt độ phòng tăng cao.", 135000m, 185000m, 80, "https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=600", 4.7, 38),
    };

    public static async Task InitializeAsync(AppDbContext context, ILogger logger)
    {
        try
        {
            logger.LogInformation("Ensuring database schema exists...");
            await context.Database.EnsureCreatedAsync();
            // DB đã tồn tại từ bản cũ (EnsureCreated không thêm bảng/cột mới) → đồng bộ schema mở rộng.
            await ExtendedSchemaSync.EnsureExtendedSchemaAsync(context, logger);

            // 1a. Super Admin duy nhất (§1.2): tài liệu quy định Role chỉ có Customer/SuperAdmin.
            // DB cũ seed Role = "Admin" → migrate về "SuperAdmin". Không có API đổi Role.
            var legacyAdmins = await context.Users.Where(u => u.Role == "Admin").ToListAsync();
            foreach (var legacyAdmin in legacyAdmins)
            {
                legacyAdmin.Role = "SuperAdmin";
                logger.LogInformation("Migrated legacy Admin role to SuperAdmin for {Email}.", legacyAdmin.Email);
            }
            if (legacyAdmins.Count > 0) await context.SaveChangesAsync();
            // Bảo vệ: nếu có hơn 1 SuperAdmin (do sửa tay), ghi cảnh báo — hệ thống vẫn chạy, admin đầu tiên giữ quyền.
            var superAdminCount = await context.Users.CountAsync(u => u.Role == "SuperAdmin");
            if (superAdminCount > 1)
                logger.LogWarning("More than one SuperAdmin account exists ({Count}). Only one SuperAdmin is expected.", superAdminCount);
            if (superAdminCount == 0 && await context.Users.AnyAsync())
                logger.LogWarning("No SuperAdmin account found. Seed admin@dafl.vn or set Role='SuperAdmin' directly in DB.");

            // 1. Seed Demo Users
            if (!await context.Users.AnyAsync())
            {
                logger.LogInformation("Seeding default demo users...");
                var passwordHash = BCrypt.Net.BCrypt.HashPassword("Password123!");

                var demoUser = new User
                {
                    Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
                    Email = "demo@dafl.vn",
                    FullName = "Nguyễn Văn Demo",
                    PasswordHash = passwordHash,
                    PhoneNumber = "0987654321",
                    Address = "Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội",
                    Role = "Customer",
                    CreatedAt = DateTime.UtcNow,
                    EmailVerified = true,
                    EmailVerifiedAt = DateTime.UtcNow
                };

                var adminUser = new User
                {
                    Id = Guid.Parse("22222222-2222-2222-2222-222222222222"),
                    Email = "admin@dafl.vn",
                    FullName = "Quản Trị Viên DAFL",
                    PasswordHash = passwordHash,
                    PhoneNumber = "0912345678",
                    Address = "Tòa nhà Keangnam, Mễ Trì, Hà Nội",
                    Role = "SuperAdmin",
                    CreatedAt = DateTime.UtcNow,
                    EmailVerified = true,
                    EmailVerifiedAt = DateTime.UtcNow
                };

                await context.Users.AddRangeAsync(demoUser, adminUser);
                await context.SaveChangesAsync();

                // Seed initial notifications for demo user
                var notifs = new List<Notification>
                {
                    new()
                    {
                        UserId = demoUser.Id,
                        Title = "Chào mừng bạn đến với DAFL Store!",
                        Message = "Tặng bạn mã ưu đãi DAFL10 giảm ngay 10% cho đơn hàng đầu tiên.",
                        Type = "Promotion",
                        IsRead = false,
                        CreatedAt = DateTime.UtcNow.AddMinutes(-30)
                    },
                    new()
                    {
                        UserId = demoUser.Id,
                        Title = "Thông báo hệ thống",
                        Message = "Hệ thống hỗ trợ đặt hàng trực tuyến và giao hàng nhanh toàn quốc.",
                        Type = "System",
                        IsRead = true,
                        CreatedAt = DateTime.UtcNow.AddHours(-2)
                    }
                };

                await context.Notifications.AddRangeAsync(notifs);
                await context.SaveChangesAsync();
            }

            // 1b. Idempotent: các user seed (demo/admin) trong DB dev cũ tạo trước khi có
            // tính năng xác thực email sẽ bị khóa ngoài ý muốn → đánh dấu đã xác thực cho chúng.
            var seedEmails = new[] { "demo@dafl.vn", "admin@dafl.vn" };
            var unverifiedSeedUsers = await context.Users
                .Where(u => seedEmails.Contains(u.Email) && !u.EmailVerified)
                .ToListAsync();
            if (unverifiedSeedUsers.Count > 0)
            {
                foreach (var seedUser in unverifiedSeedUsers)
                {
                    seedUser.EmailVerified = true;
                    seedUser.EmailVerifiedAt ??= DateTime.UtcNow;
                }
                await context.SaveChangesAsync();
                logger.LogInformation("Marked {Count} seed user(s) as email-verified.", unverifiedSeedUsers.Count);
            }

            // 2. Seed Vouchers (Idempotent: ensure FORDEV and all vouchers exist)
            var existingVouchers = await context.Vouchers.Select(v => v.Code).ToListAsync();
            var vouchersToAdd = new List<Voucher>();

            if (!existingVouchers.Contains("FORDEV"))
            {
                vouchersToAdd.Add(new Voucher
                {
                    Code = "FORDEV",
                    Description = "Voucher Test Nhà Phát Triển - Trợ giá đơn hàng chỉ còn 2.000đ để test PayOS",
                    DiscountType = "Fixed",
                    DiscountValue = 0,
                    MinOrderAmount = 0,
                    MaxDiscountAmount = null,
                    ExpiryDate = DateTime.UtcNow.AddYears(2),
                    IsActive = true,
                    MaxUsesPerUser = null // voucher seed cũ: giữ hành vi cũ, không giới hạn lượt/người
                });
            }

            if (!existingVouchers.Contains("DAFL10"))
            {
                vouchersToAdd.Add(new Voucher
                {
                    Code = "DAFL10",
                    Description = "Giảm 10% cho mọi đơn hàng (tối đa 100.000đ)",
                    DiscountType = "Percentage",
                    DiscountValue = 10,
                    MinOrderAmount = 100000,
                    MaxDiscountAmount = 100000,
                    ExpiryDate = DateTime.UtcNow.AddMonths(1),
                    IsActive = true,
                    MaxUsesPerUser = null // voucher seed cũ: giữ hành vi cũ, không giới hạn lượt/người
                });
            }

            if (!existingVouchers.Contains("DAFL20"))
            {
                vouchersToAdd.Add(new Voucher
                {
                    Code = "DAFL20",
                    Description = "Giảm trực tiếp 20.000đ cho đơn hàng tân thủ",
                    DiscountType = "Fixed",
                    DiscountValue = 20000,
                    MinOrderAmount = 100000,
                    MaxDiscountAmount = 20000,
                    ExpiryDate = DateTime.UtcNow.AddMonths(1),
                    IsActive = true,
                    MaxUsesPerUser = null // voucher seed cũ: giữ hành vi cũ, không giới hạn lượt/người
                });
            }

            if (!existingVouchers.Contains("FREESHIP"))
            {
                vouchersToAdd.Add(new Voucher
                {
                    Code = "FREESHIP",
                    Description = "Miễn phí vận chuyển 30.000đ cho đơn từ 200.000đ",
                    DiscountType = "Fixed",
                    DiscountValue = 30000,
                    MinOrderAmount = 200000,
                    MaxDiscountAmount = 30000,
                    ExpiryDate = DateTime.UtcNow.AddMonths(1),
                    IsActive = true,
                    MaxUsesPerUser = null // voucher seed cũ: giữ hành vi cũ, không giới hạn lượt/người
                });
            }

            if (!existingVouchers.Contains("VIP50K"))
            {
                vouchersToAdd.Add(new Voucher
                {
                    Code = "VIP50K",
                    Description = "Giảm trực tiếp 50.000đ cho đơn hàng từ 500.000đ",
                    DiscountType = "Fixed",
                    DiscountValue = 50000,
                    MinOrderAmount = 500000,
                    MaxDiscountAmount = 50000,
                    ExpiryDate = DateTime.UtcNow.AddMonths(1),
                    IsActive = true,
                    MaxUsesPerUser = null // voucher seed cũ: giữ hành vi cũ, không giới hạn lượt/người
                });
            }

            if (vouchersToAdd.Count > 0)
            {
                await context.Vouchers.AddRangeAsync(vouchersToAdd);
                await context.SaveChangesAsync();
                logger.LogInformation("Added {Count} vouchers into database (including FORDEV).", vouchersToAdd.Count);
            }

            // 3. Seed 26 Categories
            if (!await context.Categories.AnyAsync())
            {
                logger.LogInformation("Seeding 26 E-commerce Categories...");

                var defaultCategories = new List<Category>
                {
                    new() { Name = "Đồ gia dụng & Đời sống", Slug = "gia-dung", Description = "Thiết bị và vật dụng gia đình tiện ích", IconUrl = "🏠" },
                    new() { Name = "Đồ ăn khô & Thực phẩm chế biến", Slug = "do-an-kho", Description = "Thực phẩm sấy khô, gia vị và đặc sản", IconUrl = "🍲" },
                    new() { Name = "Quần áo & Thời trang nam nữ", Slug = "quan-ao", Description = "Trang phục thời trang đón đầu xu hướng", IconUrl = "👕" },
                    new() { Name = "Trang sức & Phụ kiện cao cấp", Slug = "trang-suc", Description = "Nhẫn, dây chuyền, bông tai tinh xảo", IconUrl = "💍" },
                    new() { Name = "Cà phê nguyên chất & Dụng cụ pha chế", Slug = "ca-phe", Description = "Cà phê Robusta, Arabica và máy xay pha chế", IconUrl = "☕" },
                    new() { Name = "Cá cảnh, Bể thủy sinh & Phụ kiện", Slug = "ca-canh", Description = "Cá cảnh, cây thủy sinh và máy lọc nước hồ cá", IconUrl = "🐠" },
                    new() { Name = "Thiết bị điện tử & Phụ kiện công nghệ", Slug = "dien-tu", Description = "Cáp sạc, tai nghe bluetooth, pin dự phòng", IconUrl = "🎧" },
                    new() { Name = "Máy tính & Thiết bị văn phòng", Slug = "may-tinh", Description = "Laptop, chuột không dây, bàn phím cơ", IconUrl = "💻" },
                    new() { Name = "Mỹ phẩm & Chăm sóc sắc đẹp", Slug = "my-pham", Description = "Skincare, son môi, nước hoa chính hãng", IconUrl = "💄" },
                    new() { Name = "Mẹ & Bé (Sữa, tã bỉm, đồ chơi)", Slug = "me-va-be", Description = "Sản phẩm an toàn dành riêng cho mẹ và bé", IconUrl = "🍼" },
                    new() { Name = "Sách & Văn phòng phẩm", Slug = "sach", Description = "Sách kinh tế, văn học, sổ tay và bút viết", IconUrl = "📚" },
                    new() { Name = "Dụng cụ thể thao & Dã ngoại", Slug = "the-thao", Description = "Đồ tập gym, yoga, lều trại dã ngoại", IconUrl = "⚽" },
                    new() { Name = "Giày dép & Túi xách thời trang", Slug = "giay-dep", Description = "Giày thể thao, giày tây, balo và ví da", IconUrl = "👟" },
                    new() { Name = "Phụ kiện ô tô & Xe máy", Slug = "xe-may-oto", Description = "Camera hành trình, mũ bảo hiểm, nhớt xe", IconUrl = "🚗" },
                    new() { Name = "Nội thất & Trang trí không gian sống", Slug = "noi-that", Description = "Bàn ghế, đèn trang trí, thảm trải sàn", IconUrl = "🛋️" },
                    new() { Name = "Thiết bị âm thanh & Nhạc cụ", Slug = "am-thanh", Description = "Đàn guitar, micro thu âm, loa soundbar", IconUrl = "🎵" },
                    new() { Name = "Trà & Đồ uống thảo mộc", Slug = "tra-thao-moc", Description = "Trà shan tuyết, trà hoa cúc thanh nhiệt", IconUrl = "🍵" },
                    new() { Name = "Thực phẩm chức năng & Sức khỏe", Slug = "thuc-pham-chuc-nang", Description = "Vitamin, collagen, máy đo huyết áp", IconUrl = "💊" },
                    new() { Name = "Đồ chơi & Mô hình sưu tầm", Slug = "do-choi", Description = "Mô hình Gundam, Lego, boardgame gia đình", IconUrl = "🎮" },
                    new() { Name = "Thú cưng & Phụ kiện chăm sóc", Slug = "thu-cung", Description = "Hạt cho chó mèo, cát vệ sinh, chuồng nệm", IconUrl = "🐾" },
                    new() { Name = "Cây cảnh & Làm vườn tại gia", Slug = "cay-canh", Description = "Sen đá, cây phong thủy để bàn, phân bón", IconUrl = "🌿" },
                    new() { Name = "Đồ thủ công mỹ nghệ & Quà tặng", Slug = "thu-cong-my-nghe", Description = "Gốm Bát Tràng, tranh thêu, nến thơm cao cấp", IconUrl = "🎁" },
                    new() { Name = "Đồng hồ thời trang & Smartwatch", Slug = "dong-ho", Description = "Đồng hồ cơ Automatic, smartwatch đo nhịp tim", IconUrl = "⌚" },
                    new() { Name = "Dụng cụ làm bánh & Đồ bếp chuyên sâu", Slug = "do-bep", Description = "Khuôn làm bánh, dao bếp Nhật, máy đánh trứng", IconUrl = "🍳" },
                    new() { Name = "Hành lý & Đồ du lịch", Slug = "du-lich", Description = "Vali kéo du lịch, túi chống nước, gối chữ U", IconUrl = "🧳" },
                    new() { Name = "Thiết bị nhà thông minh (Smart Home)", Slug = "smart-home", Description = "Khóa cửa vân tay, công tắc wifi thông minh", IconUrl = "💡" },
                };

                await context.Categories.AddRangeAsync(defaultCategories);
                await context.SaveChangesAsync();
            }

            // 4. Seed 100+ Products across all 26 Categories
            var existingProductCount = await context.Products.CountAsync();
            if (existingProductCount < 100)
            {
                logger.LogInformation("Current product count is {Count}. Seeding 104 comprehensive products across all 26 categories...", existingProductCount);

                var dbCategories = await context.Categories.ToListAsync();
                var catMap = dbCategories.ToDictionary(c => c.Slug, c => c.Id);
                var existingSlugs = (await context.Products.Select(p => p.Slug).ToListAsync()).ToHashSet();

                var allTemplates = SeedProductTemplates;

                var newProducts = new List<Product>();
                foreach (var t in allTemplates)
                {
                    if (existingSlugs.Contains(t.Slug)) continue;
                    if (!catMap.TryGetValue(t.CatSlug, out var categoryId)) continue;

                    newProducts.Add(new Product
                    {
                        CategoryId = categoryId,
                        Name = t.Name,
                        Slug = t.Slug,
                        Description = t.Desc,
                        Price = t.Price,
                        OriginalPrice = t.OrigPrice,
                        Stock = t.Stock,
                        ReservedStock = 0,
                        ImageUrl = t.Img,
                        Rating = t.Rating,
                        ReviewCount = t.RevCount
                    });
                }

                if (newProducts.Count > 0)
                {
                    await context.Products.AddRangeAsync(newProducts);
                    await context.SaveChangesAsync();
                    logger.LogInformation("Successfully seeded {Count} new products into database. Total products now: {Total}", newProducts.Count, await context.Products.CountAsync());

                    // Seed sample reviews for the first few products if needed
                    if (!await context.Evaluations.AnyAsync() && newProducts.Count >= 4)
                    {
                        var sampleReviews = new List<Evaluation>
                        {
                            new()
                            {
                                ProductId = newProducts[0].Id,
                                UserName = "Trần Hoàng Nam",
                                Rating = 5,
                                Comment = "Nồi chiên dùng rất thích, nướng gà vàng giòn mà không ngấy dầu mỡ. Đóng gói cẩn thận!",
                                CreatedAt = DateTime.UtcNow.AddDays(-3)
                            },
                            new()
                            {
                                ProductId = newProducts[0].Id,
                                UserName = "Lê Thị Thảo",
                                Rating = 4,
                                Comment = "Dung tích lớn, rửa ráy rất nhanh sạch. Giao hàng hơi muộn nửa ngày nhưng sản phẩm chất lượng.",
                                CreatedAt = DateTime.UtcNow.AddDays(-1)
                            },
                            new()
                            {
                                ProductId = newProducts[4].Id,
                                UserName = "Phạm Quang Minh",
                                Rating = 5,
                                Comment = "Hạt điều thơm nức mũi, hạt to mẩy đều và giòn rụm béo ngậy. Sẽ ủng hộ shop dài dài!",
                                CreatedAt = DateTime.UtcNow.AddDays(-5)
                            },
                            new()
                            {
                                ProductId = newProducts[8].Id,
                                UserName = "Nguyễn Hải Đăng",
                                Rating = 5,
                                Comment = "Vải áo mềm mịn thoáng mát, giặt máy không bị xù lông hay phai màu. Rất đáng tiền!",
                                CreatedAt = DateTime.UtcNow.AddDays(-2)
                            }
                        };

                        await context.Evaluations.AddRangeAsync(sampleReviews);
                        await context.SaveChangesAsync();
                    }
                }
            }

            // 5. Đồng bộ ảnh đại diện + thư viện ảnh cho sản phẩm (sửa ảnh 404 trong DB cũ, bổ sung ImagesJson)
            await SyncProductImagesAsync(context, logger);

            logger.LogInformation("Database seeding completed successfully with Categories, Products, Vouchers, and Evaluations.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while seeding the database: {Message}", ex.Message);
        }
    }
    private const int MaxGalleryImages = 4;

    /// <summary>
    /// Thư viện ảnh theo slug: ảnh chính đứng đầu, tiếp theo là ảnh của các sản phẩm cùng danh mục (xoay vòng, không trùng).
    /// </summary>
    public static Dictionary<string, List<string>> BuildSeedGalleries()
    {
        var galleries = new Dictionary<string, List<string>>();
        foreach (var group in SeedProductTemplates.GroupBy(t => t.CatSlug))
        {
            var items = group.ToList();
            for (var i = 0; i < items.Count; i++)
            {
                var images = new List<string> { items[i].Img };
                for (var step = 1; step < items.Count && images.Count < MaxGalleryImages; step++)
                {
                    var candidate = items[(i + step) % items.Count].Img;
                    if (!images.Contains(candidate)) images.Add(candidate);
                }
                galleries[items[i].Slug] = images;
            }
        }
        return galleries;
    }

    /// <summary>
    /// Đồng bộ ImageUrl và ImagesJson của các sản phẩm seed theo dữ liệu mẫu hiện hành.
    /// Seed ban đầu chỉ thêm sản phẩm mới nên DB cũ vẫn giữ URL ảnh đã chết (404); bước này sửa lại và idempotent.
    /// </summary>
    public static async Task SyncProductImagesAsync(AppDbContext context, ILogger logger)
    {
        var templates = SeedProductTemplates.ToDictionary(t => t.Slug);
        var galleries = BuildSeedGalleries();

        var fixedMain = 0;
        var updatedGalleries = 0;
        foreach (var product in await context.Products.ToListAsync())
        {
            if (!templates.TryGetValue(product.Slug, out var template)) continue;

            if (product.ImageUrl != template.Img)
            {
                product.ImageUrl = template.Img;
                fixedMain++;
            }

            var galleryJson = JsonSerializer.Serialize(galleries[product.Slug]);
            if (product.ImagesJson != galleryJson)
            {
                product.ImagesJson = galleryJson;
                updatedGalleries++;
            }
        }

        if (fixedMain > 0 || updatedGalleries > 0)
        {
            await context.SaveChangesAsync();
            logger.LogInformation("Synced product images: {Fixed} main image(s) repaired, {Galleries} gallery(ies) updated.", fixedMain, updatedGalleries);
        }
    }
}
