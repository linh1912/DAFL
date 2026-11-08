export interface ProductSpecItem {
  label: string;
  value: string;
}

export interface ProductDetailExtra {
  highlights: string[];
  specs: ProductSpecItem[];
  detailedArticle: string[];
  features: { title: string; desc: string }[];
  usageGuide: string[];
  guarantees: { title: string; desc: string }[];
}

export function getProductDetailExtra(product: {
  id: string;
  name: string;
  categoryName: string;
  description: string;
  price: number;
  rating?: number;
  reviewCount?: number;
}): ProductDetailExtra {
  const cat = (product.categoryName || '').toLowerCase();
  const productIdStr = String(product.id || '');
  const sku = `DAFL-${productIdStr.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  // 1. Determine Specs by Category Category
  let specs: ProductSpecItem[] = [
    { label: 'Mã sản phẩm (SKU)', value: sku },
    { label: 'Danh mục', value: product.categoryName || 'Sản phẩm chọn lọc' },
    { label: 'Tình trạng', value: 'Mới 100% nguyên seal hộp' },
    { label: 'Thương hiệu', value: 'Chính hãng GlowMart Mall' },
  ];

  if (cat.includes('điện thoại') || cat.includes('máy tính') || cat.includes('laptop') || cat.includes('gaming') || cat.includes('thông minh') || cat.includes('camera') || cat.includes('điện gia dụng')) {
    specs.push(
      { label: 'Nguồn điện / Kết nối', value: 'Chuẩn Type-C / USB / Wireless tiết kiệm điện' },
      { label: 'Chất liệu hoàn thiện', value: 'Hợp kim nhôm + Nhựa ABS chống cháy cao cấp' },
      { label: 'Thời gian bảo hành', value: '12 tháng chính hãng (1 đổi 1 trong 30 ngày)' },
      { label: 'Quy cách đóng gói', value: 'Fullbox kèm phụ kiện và hướng dẫn sử dụng' }
    );
  } else if (cat.includes('thời trang') || cat.includes('giày') || cat.includes('túi') || cat.includes('đồng hồ')) {
    specs.push(
      { label: 'Chất liệu vải / da', value: 'Chất liệu cao cấp, thoáng khí, đường may tỉ mỉ' },
      { label: 'Kiểu dáng', value: 'Form chuẩn hiện đại, phong cách thanh lịch trẻ trung' },
      { label: 'Hướng dẫn bảo quản', value: 'Giặt nhẹ, tránh chất tẩy rửa mạnh, ủi ở nhiệt độ vừa' },
      { label: 'Thời gian bảo hành', value: '6 tháng đối với đường chỉ may và khóa kéo' }
    );
  } else if (cat.includes('thực phẩm') || cat.includes('bánh kẹo') || cat.includes('trà') || cat.includes('ẩm thực') || cat.includes('đồ uống')) {
    specs.push(
      { label: 'Xuất xứ', value: 'Đặc sản tuyển chọn đạt chuẩn VSATTP' },
      { label: 'Hạn sử dụng', value: '12 tháng kể từ NSX (Cam kết date mới xuất xưởng)' },
      { label: 'Quy cách đóng gói', value: 'Bao bì hút chân không / Hộp kín chống ẩm vệ sinh' },
      { label: 'Bảo quản', value: 'Nơi khô ráo thoáng mát, tránh ánh nắng trực tiếp' }
    );
  } else if (cat.includes('mỹ phẩm') || cat.includes('làm đẹp') || cat.includes('sức khỏe') || cat.includes('mẹ và bé')) {
    specs.push(
      { label: 'Loại da / Đối tượng', value: 'Phù hợp mọi loại da, lành tính và an toàn sức khỏe' },
      { label: 'Xuất xứ kiểm định', value: 'Đầy đủ tem phụ và phiếu công bố tiêu chuẩn chất lượng' },
      { label: 'Hạn sử dụng', value: '36 tháng kể từ ngày sản xuất' },
      { label: 'Dung tích / Trọng lượng', value: 'Định lượng tiêu chuẩn nhà sản xuất' }
    );
  } else {
    specs.push(
      { label: 'Xuất xứ', value: 'Việt Nam / Nhập khẩu chính ngạch' },
      { label: 'Tiêu chuẩn chất lượng', value: 'Đạt chứng nhận kiểm định an toàn tiêu dùng' },
      { label: 'Thời gian bảo hành', value: '12 tháng lỗi nhà sản xuất' },
      { label: 'Chính sách đổi trả', value: 'Hỗ trợ đổi trả miễn phí trong 7 ngày' }
    );
  }

  // 2. Highlights
  const highlights = [
    `Gia công tinh xảo, đường nét sắc sảo, độ hoàn thiện cao cấp vượt tầm giá.`,
    product.description || 'Sản phẩm tiêu chuẩn chất lượng cao, bền bỉ và tối ưu trải nghiệm người dùng.',
    `Đã qua quy trình kiểm định chất lượng 3 bước nghiêm ngặt trước khi đóng gói xuất xưởng.`,
    `Đóng hộp carton chống sốc chuyên dụng, bảo vệ trọn vẹn sản phẩm khi vận chuyển toàn quốc.`
  ];

  // 3. Detailed Article
  const detailedArticle = [
    `${product.name || 'Sản phẩm'} là một trong những sản phẩm được người tiêu dùng đánh giá cao nhất trong nhóm ngành hàng ${product.categoryName || 'chọn lọc'}. Sở hữu thiết kế công thái học cùng phong cách hiện đại, sản phẩm mang lại vẻ đẹp thanh lịch và tiện dụng tối đa cho không gian sống cũng như công việc hàng ngày của bạn.`,
    product.description
      ? `Điểm nổi bật của sản phẩm nằm ở ${(product.description || '').toLowerCase()}. Nhờ ứng dụng dây chuyền công nghệ tiên tiến cùng các vật liệu tuyển chọn bền bỉ, sản phẩm không chỉ hoạt động êm ái, bền bỉ theo thời gian mà còn tiết kiệm năng lượng, thân thiện với sức khỏe người sử dụng.`
      : `Nhờ ứng dụng dây chuyền công nghệ tiên tiến cùng các vật liệu tuyển chọn bền bỉ, sản phẩm không chỉ hoạt động êm ái, bền bỉ theo thời gian mà còn tiết kiệm năng lượng, thân thiện với sức khỏe người sử dụng.`,
    `Mỗi sản phẩm khi giao đến tay khách hàng đều được kiểm tra kỹ lưỡng, nguyên seal 100% kèm theo tài liệu hướng dẫn và phiếu bảo hành chính hãng. Khách hàng được quyền mở hộp đồng kiểm trước khi thanh toán, đảm bảo an tâm tuyệt đối.`
  ];

  // 4. Feature Cards
  const features = [
    {
      title: 'Chất liệu & Độ bền cao cấp',
      desc: 'Sử dụng vật liệu tuyển chọn chống bám bẩn, chịu lực tốt và an toàn dài lâu.'
    },
    {
      title: 'Tối ưu công năng vượt trội',
      desc: 'Thiết kế thông minh giúp tiết kiệm thời gian, dễ thao tác và nâng cao trải nghiệm sống.'
    },
    {
      title: 'Đóng gói chuẩn e-Commerce',
      desc: 'Bọc bóng khí chống va đập nhiều lớp, hạn chế tối đa trầy xước trong quá trình giao vận.'
    },
    {
      title: 'Bảo hành điện tử chính hãng',
      desc: 'Kích hoạt bảo hành tự động theo số điện thoại đặt hàng, tra cứu nhanh chóng 24/7.'
    }
  ];

  // 5. Usage & Maintenance Guide
  const usageGuide = [
    'Mở hộp và kiểm tra đầy đủ phụ kiện cũng như tình trạng ngoại quan sản phẩm.',
    'Đọc kỹ tài liệu hướng dẫn chi tiết đi kèm trong hộp trước khi đưa vào vận hành.',
    'Vệ sinh nhẹ nhàng bằng khăn mềm sạch, không sử dụng hóa chất tẩy rửa có tính ăn mòn cao.',
    'Bảo quản nơi khô ráo, tránh môi trường ẩm ướt hoặc nhiệt độ quá cao trong thời gian dài.'
  ];

  // 6. Guarantees
  const guarantees = [
    {
      title: '100% Chính hãng',
      desc: 'Đền bù gấp 10 lần giá trị đơn hàng nếu phát hiện hàng giả, hàng nhái.'
    },
    {
      title: 'Đổi trả trong 7 ngày',
      desc: 'Miễn phí đổi sản phẩm mới ngay lập tức nếu xuất hiện lỗi kỹ thuật từ nhà sản xuất.'
    },
    {
      title: 'Kiểm tra trước thanh toán',
      desc: 'Hỗ trợ đồng kiểm tận tay cùng nhân viên giao hàng, ưng ý mới thanh toán (COD).'
    },
    {
      title: 'Giao hàng hỏa tốc toàn quốc',
      desc: 'Đóng gói nhanh trong ngày, giao hỏa tốc 2h tại nội thành và 24-48h liên tỉnh.'
    }
  ];

  return {
    highlights,
    specs,
    detailedArticle,
    features,
    usageGuide,
    guarantees
  };
}
