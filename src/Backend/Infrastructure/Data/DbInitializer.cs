using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Infrastructure.Data;

public static class DbInitializer
{
    private static readonly (string CatSlug, string Name, string Slug, string Desc, decimal Price, decimal? OrigPrice, int Stock, string Img, double Rating, int RevCount)[] SeedProductTemplates =
    {
        ("son-moi", "Son kem 3CE Velvet Lip Tint #Taupe", "son-kem-3ce-velvet-lip-tint-taupe", "Chất son kem xốp mịn như nhung, lên màu chuẩn sắc taupe trầm ấm, bền màu cả ngày mà không khô môi.", 289000m, 350000m, 95, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.9, 78),
        ("son-moi", "Son thỏi Rom&nd Zero Matte Lipstick #Red", "son-thoi-romand-zero-matte-red", "Son thỏi lì nhẹ tênh, màu đỏ thuần tôn da, lướt êm không lộ vân môi, giữ màu tới 6 giờ.", 199000m, 260000m, 120, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.8, 65),
        ("son-moi", "Son bóng Peripera Ink Glasting Lip Gloss", "son-bong-peripera-ink-glasting-lip-gloss", "Son bóng căng mọng hiệu ứng gương, dưỡng ẩm sâu, màu trong trẻo tự nhiên như vừa ngậm nước.", 219000m, 280000m, 85, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.8, 54),
        ("son-moi", "Son kem Clio Mad Matte Tint", "son-kem-clio-mad-matte-tint", "Son kem lì mịn, đầu cọ vát ôm sát viền môi, màu lên đều chỉ sau một lần chạm, không lem khi đeo khẩu trang.", 259000m, 320000m, 70, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.7, 43),
        ("son-moi", "Son dưỡng Laneige Lip Sleeping Mask Berry", "son-duong-laneige-lip-sleeping-mask-berry", "Mặt nạ ngủ cho môi hương berry ngọt dịu, phục hồi môi khô nứt nẻ sau một đêm, sáng dậy môi mềm căng mọng.", 349000m, 420000m, 90, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.9, 82),
        ("son-moi", "Son thỏi Maybelline Color Sensational Creamy Matte", "son-thoi-maybelline-color-sensational-creamy-matte", "Son thỏi lì dạng kem mềm mượt, sắc màu đậm đà, dưỡng ẩm nhẹ giúp môi không bị khô suốt ngày dài.", 179000m, 230000m, 110, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.7, 61),
        ("son-moi", "Son kem Rom&nd Blur Fudge Tint", "son-kem-romand-blur-fudge-tint", "Chất son bùn xốp làm mờ rãnh môi, hiệu ứng blur lì mịn, màu fudge trầm ấm hợp mọi tông da.", 229000m, 290000m, 100, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.8, 49),
        ("son-moi", "Son lì 3CE Slim Velvet Lip Color", "son-li-3ce-slim-velvet-lip-color", "Thỏi son slim thanh mảnh, chất velvet mịn lì, sắc màu thời thượng, tiện mang theo trong túi xách nhỏ.", 319000m, 390000m, 65, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600", 4.9, 57),
        ("cham-soc-da", "Serum La Roche-Posay Hyalu B5 30ml", "serum-la-roche-posay-hyalu-b5-30ml", "Serum cấp ẩm sâu với Hyaluronic Acid đa tầng và Vitamin B5, phục hồi da căng bóng, mịn màng sau 4 tuần.", 689000m, 850000m, 60, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.9, 88),
        ("cham-soc-da", "Serum The Ordinary Niacinamide 10% + Zinc 1% 30ml", "serum-the-ordinary-niacinamide-10-zinc-30ml", "Tinh chất kiềm dầu, thu nhỏ lỗ chân lông và làm mờ thâm mụn, kết cấu lỏng nhẹ thấm nhanh không nhờn rít.", 259000m, 320000m, 120, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.8, 90),
        ("cham-soc-da", "Kem dưỡng Laneige Water Bank Blue Hyaluronic Cream", "kem-duong-laneige-water-bank-blue-hyaluronic-cream", "Kem dưỡng cấp nước chuyên sâu với Blue Hyaluronic Acid, khóa ẩm 100 giờ, da căng mọng như vừa uống nước.", 590000m, 720000m, 55, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.9, 76),
        ("cham-soc-da", "Kem dưỡng CeraVe Moisturising Cream 340g", "kem-duong-cerave-moisturising-cream-340g", "Kem dưỡng phục hồi hàng rào da với 3 loại Ceramide và Hyaluronic Acid, lành tính cho cả da nhạy cảm và da em bé.", 459000m, 560000m, 80, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.9, 84),
        ("cham-soc-da", "Serum Cosrx Advanced Snail 96 Mucin Power Essence", "serum-cosrx-advanced-snail-96-mucin-power-essence", "Tinh chất ốc sên 96% phục hồi da tổn thương, cấp ẩm sâu và làm mờ sẹo thâm, da đàn hồi rõ rệt sau 2 tuần.", 389000m, 480000m, 75, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.8, 69),
        ("cham-soc-da", "Kem dưỡng Innisfree Green Tea Seed Cream", "kem-duong-innisfree-green-tea-seed-cream", "Kem dưỡng chiết xuất trà xanh đảo Jeju giàu amino acid, cấp ẩm dịu nhẹ, cân bằng dầu nước cho da hỗn hợp.", 429000m, 540000m, 70, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.7, 52),
        ("cham-soc-da", "Serum La Roche-Posay Effaclar Serum 30ml", "serum-la-roche-posay-effaclar-serum-30ml", "Serum trị mụn chuyên sâu với Salicylic Acid và Niacinamide, giảm mụn viêm, mờ thâm và se khít lỗ chân lông.", 649000m, 790000m, 50, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.8, 63),
        ("cham-soc-da", "Tinh chất Eucerin Hyaluron-Filler Serum", "tinh-chat-eucerin-hyaluron-filler-serum", "Serum chống lão hóa với Hyaluronic Acid đậm đặc, làm đầy nếp nhăn nông, da săn chắc và rạng rỡ hơn mỗi ngày.", 749000m, 890000m, 45, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.8, 47),
        ("cham-soc-da", "Kem dưỡng ẩm CeraVe PM Facial Moisturising Lotion", "kem-duong-am-cerave-pm-facial-moisturising-lotion", "Lotion dưỡng đêm phục hồi da với Ceramide và Niacinamide, thấm nhanh không bết dính, sáng dậy da mềm mại.", 389000m, 480000m, 85, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.8, 58),
        ("cham-soc-da", "Serum Innisfree Retinol Cica Repair Ampoule", "serum-innisfree-retinol-cica-repair-ampoule", "Ampoule Retinol kết hợp rau má phục hồi, mờ nếp nhăn và cải thiện kết cấu da mà vẫn dịu nhẹ, ít kích ứng.", 519000m, 650000m, 45, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.7, 41),
        ("cham-soc-da", "Kem mắt Laneige Water Bank Eye Gel", "kem-mat-laneige-water-bank-eye-gel", "Gel dưỡng mắt cấp ẩm sâu, giảm bọng mắt và quầng thâm, đầu lăn mát lạnh thư giãn vùng da quanh mắt.", 459000m, 580000m, 60, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.8, 37),
        ("cham-soc-da", "Nước cân bằng La Roche-Posay Effaclar Toner 200ml", "nuoc-can-bang-la-roche-posay-effaclar-toner-200ml", "Toner làm sạch sâu, cân bằng độ pH và kiểm soát dầu thừa, se khít lỗ chân lông cho da dầu mụn.", 379000m, 470000m, 90, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.7, 48),
        ("trang-diem", "Phấn nước Clio Kill Cover Mesh Glow Cushion", "phan-nuoc-clio-kill-cover-mesh-glow-cushion", "Cushion che phủ hoàn hảo, lớp nền căng bóng chuẩn Hàn, kiềm dầu tốt và bền màu suốt 12 giờ.", 549000m, 680000m, 70, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.9, 71),
        ("trang-diem", "Kem nền Maybelline Fit Me Matte + Poreless", "kem-nen-maybelline-fit-me-matte-poreless", "Kem nền lì kiềm dầu, che phủ lỗ chân lông, 40 tông màu tiệp mọi màu da, lớp nền mỏng nhẹ tự nhiên.", 259000m, 330000m, 100, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.8, 79),
        ("trang-diem", "Phấn phủ Innisfree No-Sebum Mineral Powder", "phan-phu-innisfree-no-sebum-mineral-powder", "Phấn phủ kiềm dầu quốc dân với bột khoáng tự nhiên, giữ lớp nền khô thoáng, không xuống tông cả ngày.", 149000m, 190000m, 130, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.9, 86),
        ("trang-diem", "Bảng mắt 3CE Multi Eye Color Palette", "bang-mat-3ce-multi-eye-color-palette", "Bảng 9 màu mắt từ lì đến nhũ, hạt phấn mịn bám tốt, phối màu dễ dàng cho cả trang điểm hàng ngày và dự tiệc.", 459000m, 580000m, 55, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.8, 44),
        ("trang-diem", "Mascara Maybelline Lash Sensational Sky High", "mascara-maybelline-lash-sensational-sky-high", "Mascara làm dài và cong mi tơi từng sợi, đầu cọ linh hoạt chải tới cả mi góc mắt, không lem không trôi.", 229000m, 290000m, 95, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.8, 67),
        ("trang-diem", "Chì kẻ mày Peripera Speedy Eyebrow Auto Pencil", "chi-ke-may-peripera-speedy-eyebrow-auto-pencil", "Chì kẻ mày đầu vát mảnh vẽ sợi mày tự nhiên, ruột chì mềm không gãy, kèm đầu chải tán đều màu.", 129000m, 170000m, 120, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.7, 52),
        ("trang-diem", "Kem lót Clio Kill Cover Glow Primer", "kem-lot-clio-kill-cover-glow-primer", "Kem lót căng bóng làm mịn lỗ chân lông, giữ lớp nền bám chặt và rạng rỡ suốt ngày dài.", 329000m, 420000m, 65, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.7, 38),
        ("trang-diem", "Phấn má hồng Rom&nd Better Than Cheek", "phan-ma-hong-romand-better-than-cheek", "Phấn má mịn như nhung, màu hồng đào ửng tự nhiên, tán đều không loang, giữ màu tươi tắn cả ngày.", 199000m, 250000m, 90, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.9, 60),
        ("nuoc-hoa", "Nước hoa Chanel Coco Mademoiselle EDP 50ml", "nuoc-hoa-chanel-coco-mademoiselle-edp-50ml", "Hương hoa cỏ phương Đông sang trọng với cam bergamot, hoa nhài và hoắc hương, lưu hương quyến rũ tới 8 giờ.", 899000m, 1150000m, 40, "https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=600", 4.9, 73),
        ("nuoc-hoa", "Nước hoa Dior Sauvage EDT 60ml", "nuoc-hoa-dior-sauvage-edt-60ml", "Hương gỗ thơm mát nam tính với cam bergamot Calabria và tiêu Tứ Xuyên, tươi mới và đầy cuốn hút.", 899000m, 1100000m, 45, "https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=600", 4.9, 68),
        ("nuoc-hoa", "Nước hoa Lancôme La Vie Est Belle EDP 30ml", "nuoc-hoa-lancome-la-vie-est-belle-edp-30ml", "Hương hoa diên vĩ và hoa nhài hòa cùng praline ngọt ngào, mùi hương hạnh phúc và nữ tính khó quên.", 799000m, 990000m, 50, "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600", 4.8, 55),
        ("nuoc-hoa", "Nước hoa Narciso Rodriguez For Her EDP 50ml", "nuoc-hoa-narciso-rodriguez-for-her-edp-50ml", "Hương xạ hương quyến rũ kết hợp hoa hồng và hổ phách, thanh lịch và gợi cảm cho buổi tối đặc biệt.", 849000m, 1050000m, 42, "https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=600", 4.9, 61),
        ("nuoc-hoa", "Nước hoa mini Versace Bright Crystal EDT 30ml", "nuoc-hoa-mini-versace-bright-crystal-edt-30ml", "Hương hoa mẫu đơn và lựu tươi mát, trong trẻo như pha lê, chai mini tiện mang theo du lịch.", 599000m, 750000m, 70, "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600", 4.8, 49),
        ("cham-soc-co-the", "Sữa dưỡng thể Vaseline Gluta-Hya Serum Burst Lotion", "sua-duong-the-vaseline-gluta-hya-serum-burst-lotion", "Lotion dưỡng thể serum burst thấm nhanh, dưỡng sáng da với GlutaGlow và Hyaluron, da mềm mịn không nhờn rít.", 189000m, 240000m, 110, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.8, 66),
        ("cham-soc-co-the", "Tẩy tế bào chết cơ thể Cocoon Đắk Lắk", "tay-te-bao-chet-co-the-cocoon-dak-lak", "Hũ tẩy tế bào chết từ hạt Đắk Lắk rang xay, làm sạch da chết và dưỡng sáng, da láng mịn ngay sau lần đầu dùng.", 165000m, 210000m, 100, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.9, 74),
        ("cham-soc-co-the", "Sữa tắm Eucerin pH5 Shower Oil", "sua-tam-eucerin-ph5-shower-oil", "Dầu tắm dịu nhẹ pH5 làm sạch mà không làm khô da, phù hợp da khô và da nhạy cảm, dùng được hằng ngày.", 329000m, 420000m, 75, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.8, 44),
        ("cham-soc-co-the", "Kem dưỡng da tay Innisfree Green Tea Hand Cream", "kem-duong-da-tay-innisfree-green-tea-hand-cream", "Kem tay trà xanh thấm nhanh, dưỡng ẩm sâu cho bàn tay mềm mại, hương trà dịu nhẹ thư giãn.", 99000m, 130000m, 130, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.7, 39),
        ("cham-soc-co-the", "Sữa dưỡng thể CeraVe Daily Moisturizing Lotion", "sua-duong-the-cerave-daily-moisturizing-lotion", "Lotion dưỡng thể phục hồi hàng rào da với Ceramide, cấp ẩm 24 giờ, không mùi, lành tính cho da nhạy cảm.", 359000m, 450000m, 85, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.8, 58),
        ("cham-soc-co-the", "Kem dưỡng thể Laneige Water Bank Body Lotion", "kem-duong-the-laneige-water-bank-body-lotion", "Lotion dưỡng thể cấp nước chuyên sâu, da căng mọng mềm mại, hương thơm tươi mát dễ chịu cả ngày.", 429000m, 540000m, 60, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.8, 51),
        ("cham-soc-toc", "Dầu gội L'Oréal Elseve Total Repair 5", "dau-goi-loreal-elseve-total-repair-5", "Dầu gội phục hồi 5 dấu hiệu hư tổn: chẻ ngọn, khô xơ, yếu gãy, thiếu bóng và khó chải, tóc chắc khỏe hơn sau 2 tuần.", 159000m, 200000m, 115, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.8, 72),
        ("cham-soc-toc", "Dầu xả L'Oréal Elseve Dream Long", "dau-xa-loreal-elseve-dream-long", "Dầu xả nuôi dưỡng tóc dài mềm mượt, giảm gãy rụng khi chải, tóc vào nếp bóng khỏe tự nhiên.", 149000m, 190000m, 110, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.7, 57),
        ("cham-soc-toc", "Serum dưỡng tóc L'Oréal Elseve Extraordinary Oil", "serum-duong-toc-loreal-elseve-extraordinary-oil", "Dầu dưỡng tóc chiết xuất 6 loại hoa quý, thấm nhanh không bết, tóc bóng mượt và thơm dịu suốt ngày.", 219000m, 280000m, 90, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.9, 69),
        ("cham-soc-toc", "Dầu dưỡng tóc Innisfree Camellia Hair Oil", "dau-duong-toc-innisfree-camellia-hair-oil", "Dầu hoa trà phục hồi tóc khô xơ do uốn nhuộm, ngọn tóc mềm mượt, hương camellia thanh khiết.", 259000m, 330000m, 70, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.8, 46),
        ("cham-soc-toc", "Xịt dưỡng tóc Cocoon tinh dầu bưởi", "xit-duong-toc-cocoon-tinh-dau-buoi", "Xịt dưỡng kích thích mọc tóc với tinh dầu vỏ bưởi nguyên chất, giảm rụng và giúp tóc con mọc khỏe.", 145000m, 185000m, 95, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.8, 63),
        ("cham-soc-toc", "Dầu gội Cocoon bồ kết và vỏ bưởi", "dau-goi-cocoon-bo-ket-va-vo-buoi", "Dầu gội thảo dược làm sạch dịu nhẹ, giảm ngứa da đầu, tóc chắc khỏe và bóng mượt tự nhiên.", 175000m, 220000m, 100, "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", 4.9, 77),
        ("mat-na", "Mặt nạ giấy Innisfree Green Tea Balancing Mask", "mat-na-giay-innisfree-green-tea-balancing-mask", "Mặt nạ giấy trà xanh cấp ẩm tức thì, cân bằng dầu nước, da tươi mát và căng mọng sau 15 phút.", 59000m, 80000m, 150, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.7, 45),
        ("mat-na", "Mặt nạ đất sét Innisfree Super Volcanic Pore Clay Mask", "mat-na-dat-set-innisfree-super-volcanic-pore-clay-mask", "Mặt nạ đất sét núi lửa hút sạch bã nhờn và mụn đầu đen, se khít lỗ chân lông, da sạch thoáng mịn màng.", 329000m, 420000m, 65, "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600", 4.8, 58),
        ("mat-na", "Mặt nạ ngủ Laneige Water Sleeping Mask", "mat-na-ngu-laneige-water-sleeping-mask", "Mặt nạ ngủ cấp nước qua đêm, sáng dậy da căng mọng rạng rỡ như vừa được ngủ đủ 8 tiếng.", 459000m, 580000m, 60, "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600", 4.9, 81),
        ("mat-na", "Mặt nạ giấy La Roche-Posay Hydraphase Mask", "mat-na-giay-la-roche-posay-hydraphase-mask", "Mặt nạ giấy cấp ẩm chuyên sâu với Hyaluronic Acid, làm dịu da khô căng, phù hợp cả da nhạy cảm.", 89000m, 120000m, 120, "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600", 4.7, 36),
        ("mat-na", "Mặt nạ The Ordinary AHA 30% + BHA 2% Peeling Solution", "mat-na-the-ordinary-aha-30-bha-2-peeling-solution", "Dung dịch tẩy tế bào chết hóa học làm sáng da, mờ thâm và mịn kết cấu da, dùng 1-2 lần mỗi tuần.", 289000m, 360000m, 80, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.8, 54),
        ("dung-cu-lam-dep", "Máy rửa mặt Foreo Luna Mini 3", "may-rua-mat-foreo-luna-mini-3", "Máy rửa mặt sóng âm T-Sonic làm sạch sâu gấp 2 lần tay, đầu cọ silicone mềm kháng khuẩn, pin dùng 650 lần.", 899000m, 1150000m, 40, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.9, 66),
        ("dung-cu-lam-dep", "Cọ trang điểm Real Techniques Everyday Essentials Set", "co-trang-diem-real-techniques-everyday-essentials-set", "Bộ 4 cọ nền, má và mắt lông tổng hợp siêu mềm, tán nền mỏng đều, kèm mút trang điểm tiện lợi.", 549000m, 690000m, 55, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.8, 42),
        ("dung-cu-lam-dep", "Bông mút trang điểm Beauty Blender Original", "bong-mut-trang-diem-beauty-blender-original", "Mút trang điểm không latex, tán kem nền mỏng mịn không vệt, dùng ướt cho lớp nền căng bóng tự nhiên.", 349000m, 450000m, 60, "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600", 4.9, 59),
        ("dung-cu-lam-dep", "Gương trang điểm LED để bàn cảm ứng", "guong-trang-diem-led-de-ban-cam-ung", "Gương LED 3 chế độ sáng mô phỏng ánh sáng tự nhiên, cảm ứng chạm tiện lợi, xoay 360 độ mọi góc nhìn.", 259000m, 330000m, 75, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600", 4.7, 33),
        ("chong-nang", "Kem chống nắng Anessa Perfect UV Sunscreen SPF50+", "kem-chong-nang-anessa-perfect-uv-sunscreen-spf50", "Kem chống nắng chống nước và mồ hôi với công nghệ Auto Booster, càng gặp nắng càng bảo vệ mạnh, không bết dính.", 489000m, 620000m, 85, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.9, 87),
        ("chong-nang", "Kem chống nắng La Roche-Posay Anthelios UVMune 400", "kem-chong-nang-la-roche-posay-anthelios-uvmune-400", "Kem chống nắng phổ rộng chống tia UVA dài, kết cấu sữa mỏng nhẹ, không vệt trắng, kiềm dầu suốt 8 giờ.", 549000m, 690000m, 70, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.9, 79),
        ("chong-nang", "Kem chống nắng CeraVe AM Facial Moisturising Lotion SPF50", "kem-chong-nang-cerave-am-facial-moisturising-lotion-spf50", "Lotion dưỡng ngày kèm chống nắng SPF50 với Ceramide, vừa dưỡng ẩm vừa bảo vệ da, dùng được hằng ngày.", 429000m, 540000m, 65, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.8, 53),
        ("chong-nang", "Xịt chống nắng Anessa Perfect UV Spray SPF50+", "xit-chong-nang-anessa-perfect-uv-spray-spf50", "Xịt chống nắng dạng sương mỏng nhẹ, xịt lại dễ dàng trên cả lớp trang điểm, chống nước và mồ hôi hiệu quả.", 389000m, 490000m, 80, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.8, 47),
        ("chong-nang", "Kem chống nắng Innisfree Intensive Long-lasting Sunscreen SPF50+", "kem-chong-nang-innisfree-intensive-long-lasting-sunscreen-spf50", "Kem chống nắng kiềm dầu lâu trôi, nâng tông nhẹ tự nhiên, dùng làm kem lót trước trang điểm rất hợp.", 299000m, 380000m, 95, "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=600", 4.7, 62),
        ("tay-trang-lam-sach", "Nước tẩy trang Bioderma Sensibio H2O 500ml", "nuoc-tay-trang-bioderma-sensibio-h2o-500ml", "Nước tẩy trang micellar số 1 cho da nhạy cảm, làm sạch cả lớp trang điểm chống nước mà không cần rửa lại.", 449000m, 560000m, 90, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.9, 90),
        ("tay-trang-lam-sach", "Sữa rửa mặt CeraVe Foaming Cleanser 236ml", "sua-rua-mat-cerave-foaming-cleanser-236ml", "Sữa rửa mặt tạo bọt dịu nhẹ làm sạch dầu thừa và bụi bẩn, giữ ẩm với Ceramide, không làm khô căng da.", 329000m, 420000m, 100, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.9, 83),
        ("tay-trang-lam-sach", "Dầu tẩy trang Innisfree Apple Seed Cleansing Oil", "dau-tay-trang-innisfree-apple-seed-cleansing-oil", "Dầu tẩy trang hạt táo nhũ hóa nhanh, cuốn sạch kem chống nắng và lớp nền, da mềm mịn không nhờn rít.", 289000m, 370000m, 85, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.8, 61),
        ("tay-trang-lam-sach", "Sữa rửa mặt La Roche-Posay Effaclar Purifying Gel", "sua-rua-mat-la-roche-posay-effaclar-purifying-gel", "Gel rửa mặt làm sạch sâu cho da dầu mụn, giảm bóng nhờn và ngăn mụn quay lại, da sạch thoáng cả ngày.", 319000m, 400000m, 95, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600", 4.8, 70),
        ("tay-trang-lam-sach", "Nước tẩy trang La Roche-Posay Micellar Water Ultra", "nuoc-tay-trang-la-roche-posay-micellar-water-ultra", "Nước tẩy trang micellar làm sạch bụi mịn và lớp trang điểm, công thức không cồn, dịu nhẹ cho da nhạy cảm.", 279000m, 350000m, 110, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", 4.7, 56),
    };

    /// <summary>10 slug danh mục mỹ phẩm chuẩn (đợt 2). Thứ tự này khớp FE fallback cat-1..cat-10 — không đổi thứ tự.</summary>
    private static readonly string[] NewCategorySlugs =
    {
        "son-moi", "cham-soc-da", "trang-diem", "nuoc-hoa", "cham-soc-co-the",
        "cham-soc-toc", "mat-na", "dung-cu-lam-dep", "chong-nang", "tay-trang-lam-sach"
    };

    public static async Task InitializeAsync(AppDbContext context, ILogger logger)
    {
        try
        {
            logger.LogInformation("Ensuring database schema exists...");
            await context.Database.EnsureCreatedAsync();
            // DB đã tồn tại từ bản cũ (EnsureCreated không thêm bảng/cột mới) → đồng bộ schema mở rộng.
            await ExtendedSchemaSync.EnsureExtendedSchemaAsync(context, logger);

            // 2c. Dọn danh mục/sản phẩm cũ không thuộc sàn mỹ phẩm (đợt 2):
            // chạy sau khi đồng bộ schema, trước mọi bước seed danh mục/sản phẩm.
            await CleanupLegacyCatalogAsync(context, logger);

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

            // 3. Seed 10 danh mục mỹ phẩm (theo đúng thứ tự FE fallback cat-1..cat-10).
            // Idempotent theo slug: chỉ thêm danh mục còn thiếu, không ghi đè danh mục đã có.
            {
                logger.LogInformation("Seeding 10 cosmetics categories...");

                var defaultCategories = new List<Category>
                {
                    new() { Name = "Son môi", Slug = "son-moi", Description = "Son kem, son thỏi, son bóng và son dưỡng chính hãng", IconUrl = "💄", SortOrder = 1 },
                    new() { Name = "Chăm sóc da", Slug = "cham-soc-da", Description = "Serum, kem dưỡng, toner và tinh chất phục hồi da", IconUrl = "🧴", SortOrder = 2 },
                    new() { Name = "Trang điểm", Slug = "trang-diem", Description = "Cushion, kem nền, phấn phủ, mascara và bảng mắt", IconUrl = "💋", SortOrder = 3 },
                    new() { Name = "Nước hoa", Slug = "nuoc-hoa", Description = "Nước hoa chính hãng cho nữ và nam, lưu hương lâu", IconUrl = "🌸", SortOrder = 4 },
                    new() { Name = "Chăm sóc cơ thể", Slug = "cham-soc-co-the", Description = "Sữa dưỡng thể, sữa tắm và tẩy tế bào chết toàn thân", IconUrl = "🛁", SortOrder = 5 },
                    new() { Name = "Chăm sóc tóc", Slug = "cham-soc-toc", Description = "Dầu gội, dầu xả, serum và xịt dưỡng tóc phục hồi", IconUrl = "💇", SortOrder = 6 },
                    new() { Name = "Mặt nạ", Slug = "mat-na", Description = "Mặt nạ giấy, mặt nạ đất sét và mặt nạ ngủ cấp ẩm", IconUrl = "🎭", SortOrder = 7 },
                    new() { Name = "Dụng cụ làm đẹp", Slug = "dung-cu-lam-dep", Description = "Máy rửa mặt, cọ, mút trang điểm và gương LED", IconUrl = "🪞", SortOrder = 8 },
                    new() { Name = "Chống nắng", Slug = "chong-nang", Description = "Kem và xịt chống nắng SPF50+ phổ rộng, kiềm dầu", IconUrl = "☀️", SortOrder = 9 },
                    new() { Name = "Tẩy trang & Làm sạch", Slug = "tay-trang-lam-sach", Description = "Nước tẩy trang, dầu tẩy trang và sữa rửa mặt dịu nhẹ", IconUrl = "🫧", SortOrder = 10 },
                };

                var existingCategorySlugs = (await context.Categories.Select(c => c.Slug).ToListAsync()).ToHashSet();
                var categoriesToAdd = defaultCategories.Where(c => !existingCategorySlugs.Contains(c.Slug)).ToList();
                if (categoriesToAdd.Count > 0)
                {
                    await context.Categories.AddRangeAsync(categoriesToAdd);
                    await context.SaveChangesAsync();
                    logger.LogInformation("Added {Count} cosmetics categories.", categoriesToAdd.Count);
                }
            }

            // 4. Seed 64 sản phẩm mỹ phẩm (idempotent theo slug: chỉ seed phần còn thiếu).
            var cosmeticCategoryIds = await context.Categories
                .Where(c => NewCategorySlugs.Contains(c.Slug))
                .Select(c => c.Id)
                .ToListAsync();
            var existingCosmeticCount = await context.Products.CountAsync(p => cosmeticCategoryIds.Contains(p.CategoryId));
            if (existingCosmeticCount < 60)
            {
                logger.LogInformation("Current cosmetics product count is {Count}. Seeding 64 cosmetics products across 10 categories...", existingCosmeticCount);

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
                                Comment = "Son 3CE lên màu chuẩn đẹp, chất kem mịn không khô môi, bền màu cả ngày. Đóng gói cẩn thận!",
                                CreatedAt = DateTime.UtcNow.AddDays(-3)
                            },
                            new()
                            {
                                ProductId = newProducts[1].Id,
                                UserName = "Lê Thị Thảo",
                                Rating = 4,
                                Comment = "Son Rom&nd màu đỏ tôn da, đánh lên sáng mặt hẳn. Giao hàng hơi muộn nửa ngày nhưng sản phẩm chất lượng.",
                                CreatedAt = DateTime.UtcNow.AddDays(-1)
                            },
                            new()
                            {
                                ProductId = newProducts[2].Id,
                                UserName = "Phạm Quang Minh",
                                Rating = 5,
                                Comment = "Son bóng Peripera căng mọng như gương, không dính tóc, mùi thơm nhẹ dễ chịu. Sẽ ủng hộ shop dài dài!",
                                CreatedAt = DateTime.UtcNow.AddDays(-5)
                            },
                            new()
                            {
                                ProductId = newProducts[3].Id,
                                UserName = "Nguyễn Hải Đăng",
                                Rating = 5,
                                Comment = "Son Clio lì mịn, đầu cọ vát kẻ viền môi rất dễ, màu lên đều chỉ một lần chạm. Rất đáng tiền!",
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
    /// <summary>
    /// Dọn danh mục/sản phẩm cũ không thuộc 10 danh mục mỹ phẩm mới (đợt 2).
    /// Chạy sau ExtendedSchemaSync, trước mọi bước seed danh mục/sản phẩm.
    /// - Sản phẩm thuộc danh mục cũ mà KHÔNG có OrderItem nào tham chiếu (tra qua
    ///   DbSet OrderItems, khóa OrderItem.ProductId) thì xóa hẳn.
    /// - Sản phẩm ĐÃ có OrderItem tham chiếu thì chỉ ẩn khỏi shop (Stock = 0 và
    ///   IsActive = false — cả hai thuộc tính đều có trên entity Product) để giữ
    ///   nguyên lịch sử đơn hàng, đánh giá và voucher/giỏ hàng liên quan.
    /// - Danh mục cũ chỉ bị xóa khi không còn sản phẩm nào thuộc nó.
    /// Không động vào user, đơn hàng, voucher, giỏ hàng hay đánh giá của sản phẩm còn tham chiếu.
    /// </summary>
    private static async Task CleanupLegacyCatalogAsync(AppDbContext context, ILogger logger)
    {
        var legacyCategories = await context.Categories
            .Where(c => !NewCategorySlugs.Contains(c.Slug))
            .ToListAsync();
        if (legacyCategories.Count == 0)
        {
            logger.LogInformation("No legacy categories found. Catalog is already cosmetics-only.");
            return;
        }

        logger.LogInformation("Found {Count} legacy categories to clean up.", legacyCategories.Count);
        var deletedProducts = 0;
        var hiddenProducts = 0;
        var deletedCategories = 0;

        foreach (var legacyCategory in legacyCategories)
        {
            var products = await context.Products
                .Where(p => p.CategoryId == legacyCategory.Id)
                .ToListAsync();

            if (products.Count > 0)
            {
                var productIds = products.Select(p => p.Id).ToList();
                var referencedProductIds = (await context.OrderItems
                    .Where(oi => productIds.Contains(oi.ProductId))
                    .Select(oi => oi.ProductId)
                    .ToListAsync()).ToHashSet();

                foreach (var product in products)
                {
                    if (referencedProductIds.Contains(product.Id))
                    {
                        // Còn đơn hàng tham chiếu: chỉ ẩn khỏi shop, giữ nguyên lịch sử đơn.
                        product.Stock = 0;
                        product.IsActive = false;
                        hiddenProducts++;
                        logger.LogInformation(
                            "Hid legacy product {Slug} (category {CategorySlug}): still referenced by order items.",
                            product.Slug, legacyCategory.Slug);
                    }
                    else
                    {
                        context.Products.Remove(product);
                        deletedProducts++;
                    }
                }
                await context.SaveChangesAsync();
            }

            // Chỉ xóa danh mục khi không còn sản phẩm nào thuộc nó.
            var remainingCount = await context.Products.CountAsync(p => p.CategoryId == legacyCategory.Id);
            if (remainingCount == 0)
            {
                context.Categories.Remove(legacyCategory);
                await context.SaveChangesAsync();
                deletedCategories++;
                logger.LogInformation("Deleted legacy category {Slug}.", legacyCategory.Slug);
            }
            else
            {
                logger.LogWarning(
                    "Kept legacy category {Slug}: {Count} product(s) still referenced by orders remain hidden in it.",
                    legacyCategory.Slug, remainingCount);
            }
        }

        logger.LogInformation(
            "Legacy catalog cleanup done: {DeletedProducts} product(s) deleted, {HiddenProducts} product(s) hidden, {DeletedCategories} categor(ies) deleted.",
            deletedProducts, hiddenProducts, deletedCategories);
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
