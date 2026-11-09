using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Infrastructure.Data;

/// <summary>Máy trạng thái đơn hàng (§4, đợt 13):
/// luồng chính Pending → Paid (PayOS webhook) → Confirmed → Preparing → Shipping → Delivered → Completed.
/// COD bỏ qua Paid: Pending → Confirmed. Lối tắt cho phép: Paid → Preparing (admin xác nhận + chuẩn bị
/// trong một bước), Confirmed → Shipping (bỏ qua bước chuẩn bị).
/// Hủy được từ Pending / Paid / Confirmed / Preparing (khách chỉ hủy Pending-COD + Paid/Confirmed/Preparing;
/// xem <see cref="DAFL.Backend.Features.Admin.OrderStateMachine"/>).
/// Expired là trạng thái cuối do hệ thống đặt: đơn Pending + PayOS chưa thanh toán, quá 15 phút giữ chỗ
/// thì <see cref="DAFL.Backend.Features.Orders.ReservationCleanupWorker"/> chuyển sang Expired.
/// Cancelled / Expired / Completed là trạng thái cuối — không chuyển đi đâu nữa.</summary>
public enum OrderStatus
{
    Pending = 0,    // COD: "Chờ xác nhận" · PayOS: "Chờ thanh toán"
    Paid = 1,       // Đã thanh toán (PayOS) → đang "Chờ xác nhận" xử lý
    Cancelled = 2,  // Đã hủy
    Expired = 3,    // "Hết hạn thanh toán" — hết hạn giữ chỗ 15 phút (chỉ PayOS, do hệ thống đặt)
    Preparing = 4,  // "Đang chuẩn bị" — sau Confirmed, trước Shipping
    Shipping = 5,   // Đang giao
    Delivered = 6,  // Đã giao
    Confirmed = 7,  // Admin đã xác nhận (sau Paid / Pending-COD) — mới theo tài liệu §4
    Completed = 8,  // Khách đã nhận hàng / tự hoàn tất sau 3 ngày — mới theo tài liệu §4
    ReturnRequested = 9 // Khách yêu cầu trả hàng trong 7 ngày từ Delivered — mới theo tài liệu §9.2
}

// ==========================================
// 1. Auth Module Domain Entities
// ==========================================

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    /// <summary>Nullable từ v4: tài khoản tạo qua social login chưa đặt mật khẩu thì để null.</summary>
    public string? PasswordHash { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? Address { get; set; }
    public string? AvatarUrl { get; set; }
    public string Role { get; set; } = "Customer"; // "Customer" | "SuperAdmin" (tài liệu §1.2; giá trị cũ "Admin" được DbInitializer migrate về "SuperAdmin")
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Admin khóa tài khoản: không đăng nhập và không checkout được (tài liệu §3).</summary>
    public bool IsLocked { get; set; } = false;
    /// <summary>Tăng mỗi lần đổi/đặt lại mật khẩu → mọi JWT cũ (mang tv cũ) bị vô hiệu (tài liệu §2.2).</summary>
    public int TokenVersion { get; set; } = 0;
    public DateTime? LastLoginAt { get; set; }

    // --- Hội viên (tài liệu §5): hạng + chi tiêu 12 tháng + thanh toán nhanh (§6) ---
    /// <summary>Hạng hội viên: Member | Silver | Gold | Diamond (mặc định Member).</summary>
    public string MembershipTier { get; set; } = "Member";
    /// <summary>Tổng chi tiêu từ các đơn Completed trong 12 tháng gần nhất — cơ sở xét hạng.</summary>
    public decimal TotalSpent12m { get; set; } = 0;
    public DateTime? BirthDate { get; set; }
    /// <summary>Ngày đổi BirthDate gần nhất — khóa sửa ngày sinh 90 ngày chống trục lợi voucher sinh nhật (§7.6).</summary>
    public DateTime? BirthDateChangedAt { get; set; }
    /// <summary>Phương thức mặc định cho thanh toán nhanh: COD | PayOS (chỉ lưu lựa chọn, không lưu thẻ/key).</summary>
    public string? DefaultPaymentMethod { get; set; }
    public bool AutoUsePoints { get; set; } = false;

    // --- Xác thực email: theo CN, đăng ký bằng mật khẩu dùng ngay (không OTP);
    // cờ này còn dùng cho tài khoản social (email đã được nhà cung cấp xác thực = true). ---
    public bool EmailVerified { get; set; } = false;
    public DateTime? EmailVerifiedAt { get; set; }

    public List<UserExternalIdentity> ExternalIdentities { get; set; } = new();
    public List<UserAddress> Addresses { get; set; } = new();
    public List<Notification> Notifications { get; set; } = new();
    public List<Order> Orders { get; set; } = new();
    public List<Evaluation> Evaluations { get; set; } = new();
}

/// <summary>
/// Sổ địa chỉ giao hàng của khách (CN-03.3): tối đa 5 địa chỉ/tài khoản,
/// địa chỉ đầu tiên tự động là mặc định, đúng 1 địa chỉ mặc định tại một thời điểm.
/// Đơn hàng lưu BẢN SAO (snapshot) địa chỉ nên sửa/xóa ở đây không ảnh hưởng đơn cũ.
/// </summary>
public class UserAddress
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string RecipientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string ProvinceCode { get; set; } = string.Empty;
    public string ProvinceName { get; set; } = string.Empty;
    public string DistrictCode { get; set; } = string.Empty;
    public string DistrictName { get; set; } = string.Empty;
    public string WardCode { get; set; } = string.Empty;
    public string WardName { get; set; } = string.Empty;
    public string DetailAddress { get; set; } = string.Empty;
    public string? Note { get; set; }
    public bool IsDefault { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Định danh đăng nhập ngoài (Google/Facebook) gắn với một tài khoản DAFL (Luồng 6 — bản chốt v4).
/// Một định danh (Provider, ProviderUserId) chỉ thuộc về đúng một tài khoản;
/// một tài khoản tối đa một định danh cho mỗi nhà cung cấp.
/// </summary>
public class UserExternalIdentity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string Provider { get; set; } = string.Empty; // "google" | "facebook"
    public string ProviderUserId { get; set; } = string.Empty;
    public string? Email { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class SocialProviders
{
    public const string Google = "google";
    public const string Facebook = "facebook";
}

public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Type { get; set; } = "System"; // Order, Payment, Promotion, System
    public bool IsRead { get; set; } = false;
    public string? MetadataJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ==========================================
// 2. Shopify (E-commerce) Module Domain Entities
// ==========================================

public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    /// <summary>false = danh mục ẩn khỏi shop (quản trị §3.1).</summary>
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Product> Products { get; set; } = new();
}

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public decimal? OriginalPrice { get; set; }
    public int Stock { get; set; }
    public int ReservedStock { get; set; }
    public string ImageUrl { get; set; } = string.Empty;
    public string? ImagesJson { get; set; }
    public double Rating { get; set; } = 5.0;
    public int ReviewCount { get; set; } = 0;
    /// <summary>false = đã ngừng bán: ẩn khỏi danh sách (CN-04) và không cho thêm giỏ/đặt hàng.</summary>
    public bool IsActive { get; set; } = true;
    /// <summary>Xóa mềm (admin xóa sản phẩm đã từng có đơn — giữ lịch sử đơn nguyên vẹn, §3.1).</summary>
    public bool IsDeleted { get; set; } = false;
    public uint Version { get; set; } // Concurrency token
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<Evaluation> Evaluations { get; set; } = new();
    public List<OrderItem> OrderItems { get; set; } = new();
}

public class Cart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string? SessionId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public List<CartItem> Items { get; set; } = new();
}

public class CartItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CartId { get; set; }
    public Cart? Cart { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public int Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}

public class Voucher
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty; // e.g. DAFL10, FREESHIP
    public string Description { get; set; } = string.Empty;
    public string DiscountType { get; set; } = "Percentage"; // Percentage, Fixed
    public decimal DiscountValue { get; set; }
    public decimal MinOrderAmount { get; set; } = 0;
    public decimal? MaxDiscountAmount { get; set; }
    public DateTime? ExpiryDate { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>Giới hạn tổng số lượt dùng của mã (null = không giới hạn). Kiểm tra lại ở BE khi đặt hàng (O1).</summary>
    public int? MaxUses { get; set; }
    /// <summary>Số lượt đã dùng thành công (tăng trong cùng transaction đặt hàng).</summary>
    public int UsedCount { get; set; } = 0;

    // --- Khuyến mãi mở rộng (tài liệu §7.2/§7.6): vòng đời + hạng + phạm vi + voucher cá nhân ---
    /// <summary>Ngày bắt đầu áp dụng (null = bắt đầu ngay). Trước thời điểm này mã "chưa bắt đầu".</summary>
    public DateTime? StartDate { get; set; }
    /// <summary>Lượt dùng tối đa / tài khoản (mặc định 1 theo §7.3; null = không giới hạn).</summary>
    public int? MaxUsesPerUser { get; set; } = 1;
    /// <summary>Hạng tối thiểu được dùng: Member | Silver | Gold | Diamond (null = mọi hạng).</summary>
    public string? MinTier { get; set; }
    /// <summary>Phạm vi: All | Category | Product. Giảm chỉ tính trên phần thuộc phạm vi (§7.5 bước 6).</summary>
    public string ScopeType { get; set; } = "All";
    public Guid? ScopeCategoryId { get; set; }
    /// <summary>Danh sách ProductId thuộc phạm vi, nối bằng dấu phẩy (chỉ khi ScopeType = Product).</summary>
    public string? ScopeProductIds { get; set; }
    /// <summary>Vòng đời: Draft | Active | Disabled | Expired. IsActive phản ánh trạng thái hiệu lực (Active).</summary>
    public string Status { get; set; } = "Active";
    public string? DisabledReason { get; set; }
    /// <summary>Voucher cá nhân (sinh nhật / chào hạng): chỉ đúng tài khoản này dùng được; null = voucher công khai.</summary>
    public Guid? OwnerUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long OrderCode { get; set; }
    /// <summary>Mã đơn hiển thị theo CN-07, dạng DH{yyyyMMdd}-{số thứ tự 4 chữ số}, ví dụ DH20261101-0001.</summary>
    public string? OrderDisplayCode { get; set; }
    /// <summary>Phương thức thanh toán: "COD" | "PayOS" (O1 giữ cả hai).</summary>
    public string PaymentMethod { get; set; } = "COD";
    /// <summary>Phí vận chuyển thực tế của đơn (O1: 25.000đ, miễn phí khi tạm tính ≥ 299.000đ hoặc voucher FREESHIP).</summary>
    public decimal ShippingFee { get; set; }
    /// <summary>Mã chống trùng khi đặt hàng (header Idempotency-Key hoặc body) — gửi trùng trả lại đơn đã tạo (CN-07 E5).</summary>
    public string? IdempotencyKey { get; set; }
    /// <summary>true = tồn kho đã trừ thật (COD khi tạo đơn, PayOS khi webhook xác nhận); false = đang giữ chỗ (PayOS chờ thanh toán).</summary>
    public bool StockDeducted { get; set; } = false;
    /// <summary>Lý do + thời điểm hủy đơn (CN-08.3), null nếu chưa hủy.</summary>
    public string? CancelReason { get; set; }
    public DateTime? CancelledAt { get; set; }
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string ShippingAddress { get; set; } = string.Empty;

    // --- Snapshot giao hàng cấu trúc (Mục 7B.4 — bản chốt v4): bất biến sau khi đặt đơn ---
    public string? ShipProvinceCode { get; set; }
    public string? ShipProvinceName { get; set; }
    public string? ShipDistrictCode { get; set; }
    public string? ShipDistrictName { get; set; }
    public string? ShipWardCode { get; set; }
    public string? ShipWardName { get; set; }
    public string? ShipDetailAddress { get; set; }
    public string? ShipNote { get; set; }
    /// <summary>Id địa chỉ trong sổ địa chỉ mà khách đã chọn (chỉ truy vết, không dùng để hiển thị).</summary>
    public Guid? AddressBookId { get; set; }
    public decimal SubTotal { get; set; }
    public decimal DiscountAmount { get; set; }
    public string? VoucherCode { get; set; }
    public decimal TotalAmount { get; set; }
    // --- Điểm hội viên + vận đơn + ghi chú nội bộ (tài liệu §5/§8/§10.1) ---
    /// <summary>Số điểm đã dùng ở checkout (1 điểm = 1.000đ).</summary>
    public int PointsUsed { get; set; } = 0;
    /// <summary>Số tiền được trừ nhờ điểm (= PointsUsed × 1.000đ, đã nằm trong TotalAmount).</summary>
    public decimal PointsDiscount { get; set; } = 0;
    /// <summary>Số điểm đã cộng khi đơn Completed (0 nếu chưa hoàn tất).</summary>
    public int PointsEarned { get; set; } = 0;
    /// <summary>Mã freeship đã áp (voucher thứ hai theo quy tắc stacking §7.3).</summary>
    public string? FreeShipVoucherCode { get; set; }
    /// <summary>Mã vận đơn — bắt buộc khi admin chuyển sang Shipping (§4).</summary>
    public string? TrackingCode { get; set; }
    public string? Carrier { get; set; }
    /// <summary>Ghi chú nội bộ của admin — khách không thấy (§8.3).</summary>
    public string? InternalNote { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(15);
    public string? PayOSCheckoutUrl { get; set; }

    public List<OrderItem> Items { get; set; } = new();
    public List<PaymentTransaction> Transactions { get; set; } = new();
    public List<OrderStatusHistory> StatusHistories { get; set; } = new();
}

public class OrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string? ProductImageUrl { get; set; }
    public decimal UnitPrice { get; set; }
    public int Quantity { get; set; }
}

public class OrderStatusHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public OrderStatus Status { get; set; }
    /// <summary>Trạng thái trước khi chuyển (null = mốc đầu tiên khi tạo đơn).</summary>
    public OrderStatus? PreviousStatus { get; set; }
    /// <summary>Người thực hiện chuyển trạng thái (null = hệ thống: webhook PayOS / job hết hạn).</summary>
    public Guid? ChangedByUserId { get; set; }
    public string Note { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class Evaluation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string UserName { get; set; } = string.Empty;
    public int Rating { get; set; } = 5; // 1 to 5
    public string Comment { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class PaymentTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public long OrderCode { get; set; }
    public decimal Amount { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? PayOSTransactionId { get; set; }
    public string? Checksum { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ==========================================
// 2B. Hội viên / Khuyến mãi / Quản trị — thực thể mới (tài liệu §10.1)
// ==========================================

/// <summary>Sổ cái điểm hội viên (§5.2): chỉ thêm dòng, không sửa — số dư suy ra từ các dòng còn hiệu lực.</summary>
public class PointTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid? OrderId { get; set; }
    public Order? Order { get; set; }
    /// <summary>EARN | USE | REFUND | REVOKE | EXPIRED | ADMIN_ADJUST.</summary>
    public string Type { get; set; } = string.Empty;
    /// <summary>Số điểm của dòng này (dương = cộng, âm = trừ).</summary>
    public int Points { get; set; }
    /// <summary>Điểm còn lại trong "lô" này (chỉ dùng cho dòng dương: EARN/REFUND/ADMIN_ADJUST).
    /// Dùng điểm trừ FIFO theo hạn dùng; hết hạn thì lô còn lại → EXPIRED. Null với dòng âm.</summary>
    public int? RemainingPoints { get; set; }
    /// <summary>Hạn dùng của lô điểm (EARN: +12 tháng). Null với dòng âm.</summary>
    public DateTime? ExpiresAt { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Lượt dùng voucher theo tài khoản (§7.3/§7.5 bước 4): đếm khi đơn tạo thành công, nhả khi hủy/trả toàn bộ.</summary>
public class PromotionUsage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VoucherId { get; set; }
    public Voucher? Voucher { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public decimal DiscountAmount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Cấu hình 1 hạng hội viên (§5.1): ngưỡng chi tiêu 12 tháng + tỉ lệ tích điểm + trần dùng điểm + freeship.
/// Admin sửa được ở /admin/membership; thay đổi chỉ áp dụng cho đơn phát sinh sau đó.</summary>
public class MembershipTierConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Member | Silver | Gold | Diamond.</summary>
    public string Tier { get; set; } = string.Empty;
    /// <summary>Chi tiêu 12 tháng tối thiểu để đạt hạng (đ).</summary>
    public decimal MinSpent { get; set; }
    /// <summary>Số tiền chi tiêu để tích 1 điểm (Member 20.000, Silver 15.000, Gold 10.000, Diamond 8.000).</summary>
    public int SpendPerPoint { get; set; }
    /// <summary>Tỉ lệ % tối đa của tiền hàng được trả bằng điểm (10 / 15 / 20 / 30).</summary>
    public int MaxPointsPercent { get; set; }
    /// <summary>Đơn từ mức này được freeship theo hạng (null = không freeship theo hạng; 0 = freeship mọi đơn).</summary>
    public decimal? FreeShipThreshold { get; set; }
    public int SortOrder { get; set; }
}

/// <summary>Nhật ký admin (§1.3/§3): chỉ thêm, không sửa/xóa qua giao diện.</summary>
public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ActorId { get; set; }
    public string ActorEmail { get; set; } = string.Empty;
    /// <summary>VD: ADMIN_UPDATE_PROFILE, ADMIN_CHANGE_ORDER_STATUS, ADMIN_ADJUST_POINTS…</summary>
    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? OldValueJson { get; set; }
    public string? NewValueJson { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Yêu cầu trả hàng của khách (§9.2): trong 7 ngày từ Delivered, chờ admin duyệt.</summary>
public class ReturnRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? Note { get; set; }
    /// <summary>Pending | Approved | Rejected.</summary>
    public string Status { get; set; } = "Pending";
    public string? AdminNote { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
    public List<RefundRecord> Refunds { get; set; } = new();
}

/// <summary>Ghi nhận hoàn tiền thủ công (§9.2): KHÔNG tự động hoàn qua PayOS — admin hoàn ngoài hệ thống rồi nhập mã GD.</summary>
public class RefundRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReturnRequestId { get; set; }
    public ReturnRequest? ReturnRequest { get; set; }
    public Guid OrderId { get; set; }
    public decimal Amount { get; set; }
    /// <summary>PendingRefund (chờ hoàn tiền) | Refunded (đã hoàn tiền).</summary>
    public string Status { get; set; } = "PendingRefund";
    public string? TransactionCode { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RefundedAt { get; set; }
}

/// <summary>Mã đặt lại mật khẩu (§9.1): mã 6 số được BĂM trước khi lưu, hạn 15 phút, tối đa 5 lần nhập sai.</summary>
public class PasswordResetCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string CodeHash { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public int FailedAttempts { get; set; } = 0;
    public bool IsUsed { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Email đăng ký nhận bản tin (footer). Bảng được tạo trên DB cũ qua
/// ExtendedSchemaSync (CREATE TABLE IF NOT EXISTS) như các bảng mở rộng khác.</summary>
public class NewsletterSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ==========================================
// 3. EF Core DbContext Definition
// ==========================================

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // Auth Module DbSets
    public DbSet<User> Users => Set<User>();
    public DbSet<UserExternalIdentity> UserExternalIdentities => Set<UserExternalIdentity>();
    public DbSet<UserAddress> UserAddresses => Set<UserAddress>();
    public DbSet<Notification> Notifications => Set<Notification>();

    // Shopify Module DbSets
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Cart> Carts => Set<Cart>();
    public DbSet<CartItem> CartItems => Set<CartItem>();
    public DbSet<Voucher> Vouchers => Set<Voucher>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderStatusHistory> OrderStatusHistories => Set<OrderStatusHistory>();
    public DbSet<Evaluation> Evaluations => Set<Evaluation>();
    public DbSet<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();

    // Hội viên / Khuyến mãi / Quản trị (mới)
    public DbSet<PointTransaction> PointTransactions => Set<PointTransaction>();
    public DbSet<PromotionUsage> PromotionUsages => Set<PromotionUsage>();
    public DbSet<MembershipTierConfig> MembershipTierConfigs => Set<MembershipTierConfig>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<ReturnRequest> ReturnRequests => Set<ReturnRequest>();
    public DbSet<RefundRecord> RefundRecords => Set<RefundRecord>();
    public DbSet<PasswordResetCode> PasswordResetCodes => Set<PasswordResetCode>();
    public DbSet<NewsletterSubscription> NewsletterSubscriptions => Set<NewsletterSubscription>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // --- Auth Module Configurations ---
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.Email).HasMaxLength(150).IsRequired();
            entity.Property(u => u.FullName).HasMaxLength(150).IsRequired();
            entity.Property(u => u.MembershipTier).HasMaxLength(20).HasDefaultValue("Member");
            entity.Property(u => u.TotalSpent12m).HasPrecision(18, 2);
            entity.Property(u => u.PhoneNumber).HasMaxLength(20);
        });

        modelBuilder.Entity<UserExternalIdentity>(entity =>
        {
            entity.HasKey(i => i.Id);
            entity.HasIndex(i => new { i.Provider, i.ProviderUserId }).IsUnique();
            entity.HasIndex(i => new { i.UserId, i.Provider }).IsUnique();
            entity.Property(i => i.Provider).HasMaxLength(30).IsRequired();
            entity.Property(i => i.ProviderUserId).HasMaxLength(150).IsRequired();
            entity.HasOne(i => i.User)
                  .WithMany(u => u.ExternalIdentities)
                  .HasForeignKey(i => i.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserAddress>(entity =>
        {
            entity.HasKey(a => a.Id);
            entity.HasIndex(a => a.UserId);
            entity.Property(a => a.RecipientName).HasMaxLength(150).IsRequired();
            entity.Property(a => a.Phone).HasMaxLength(20).IsRequired();
            entity.HasOne(a => a.User)
                  .WithMany(u => u.Addresses)
                  .HasForeignKey(a => a.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasKey(n => n.Id);
            entity.HasIndex(n => n.UserId);
            entity.HasIndex(n => n.CreatedAt);
            entity.Property(n => n.Title).HasMaxLength(250).IsRequired();
            entity.HasOne(n => n.User)
                  .WithMany(u => u.Notifications)
                  .HasForeignKey(n => n.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // --- Shopify Module Configurations ---
        modelBuilder.Entity<Category>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.Slug).IsUnique();
            entity.Property(c => c.Name).HasMaxLength(150).IsRequired();
            entity.Property(c => c.Slug).HasMaxLength(150).IsRequired();
        });

        modelBuilder.Entity<PointTransaction>(entity =>
        {
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.UserId);
            entity.HasIndex(p => p.OrderId);
            entity.Property(p => p.Type).HasMaxLength(20).IsRequired();
            entity.HasOne(p => p.User).WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(p => p.Order).WithMany().HasForeignKey(p => p.OrderId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PromotionUsage>(entity =>
        {
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => new { p.VoucherId, p.UserId });
            entity.HasIndex(p => p.OrderId);
            entity.Property(p => p.DiscountAmount).HasPrecision(18, 2);
            entity.HasOne(p => p.Voucher).WithMany().HasForeignKey(p => p.VoucherId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(p => p.User).WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(p => p.Order).WithMany().HasForeignKey(p => p.OrderId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MembershipTierConfig>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.Tier).IsUnique();
            entity.Property(c => c.Tier).HasMaxLength(20).IsRequired();
            entity.Property(c => c.MinSpent).HasPrecision(18, 2);
            entity.Property(c => c.FreeShipThreshold).HasPrecision(18, 2);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasKey(a => a.Id);
            entity.HasIndex(a => a.ActorId);
            entity.HasIndex(a => a.Action);
            entity.HasIndex(a => a.CreatedAt);
            entity.Property(a => a.Action).HasMaxLength(100).IsRequired();
        });

        modelBuilder.Entity<ReturnRequest>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.OrderId);
            entity.HasIndex(r => r.UserId);
            entity.Property(r => r.Status).HasMaxLength(20).IsRequired();
            entity.HasOne(r => r.Order).WithMany().HasForeignKey(r => r.OrderId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(r => r.User).WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RefundRecord>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.ReturnRequestId);
            entity.HasIndex(r => r.OrderId);
            entity.Property(r => r.Amount).HasPrecision(18, 2);
            entity.Property(r => r.Status).HasMaxLength(20).IsRequired();
            entity.HasOne(r => r.ReturnRequest).WithMany(rr => rr.Refunds).HasForeignKey(r => r.ReturnRequestId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PasswordResetCode>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.UserId);
            entity.HasIndex(c => c.CreatedAt);
            entity.HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Product>(entity =>
        {
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.CategoryId);
            entity.HasIndex(p => p.Slug);
            entity.Property(p => p.Name).HasMaxLength(250).IsRequired();
            entity.Property(p => p.Price).HasPrecision(18, 2);
            entity.Property(p => p.OriginalPrice).HasPrecision(18, 2);

            // xmin chỉ có trên PostgreSQL; SQLite/InMemory không tự sinh giá trị này
            if (Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL")
            {
                entity.Property(p => p.Version).IsRowVersion();
            }

            entity.HasOne(p => p.Category)
                  .WithMany(c => c.Products)
                  .HasForeignKey(p => p.CategoryId)
                  .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Cart>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.UserId);
            entity.HasIndex(c => c.SessionId);
            entity.HasOne(c => c.User)
                  .WithMany()
                  .HasForeignKey(c => c.UserId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CartItem>(entity =>
        {
            entity.HasKey(ci => ci.Id);
            entity.Property(ci => ci.UnitPrice).HasPrecision(18, 2);
            entity.HasOne(ci => ci.Cart)
                  .WithMany(c => c.Items)
                  .HasForeignKey(ci => ci.CartId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(ci => ci.Product)
                  .WithMany()
                  .HasForeignKey(ci => ci.ProductId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Voucher>(entity =>
        {
            entity.HasKey(v => v.Id);
            entity.HasIndex(v => v.Code).IsUnique();
            entity.Property(v => v.Code).HasMaxLength(50).IsRequired();
            entity.Property(v => v.DiscountValue).HasPrecision(18, 2);
            entity.Property(v => v.MinOrderAmount).HasPrecision(18, 2);
            entity.Property(v => v.MaxDiscountAmount).HasPrecision(18, 2);
            entity.HasIndex(v => v.OwnerUserId);
            entity.HasIndex(v => v.Status);
        });

        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasKey(o => o.Id);
            entity.HasIndex(o => o.OrderCode).IsUnique();
            entity.HasIndex(o => o.OrderDisplayCode).IsUnique();
            entity.HasIndex(o => o.IdempotencyKey).IsUnique();
            entity.HasIndex(o => o.Status);
            entity.HasIndex(o => o.UserId);
            entity.Property(o => o.SubTotal).HasPrecision(18, 2);
            entity.Property(o => o.DiscountAmount).HasPrecision(18, 2);
            entity.Property(o => o.ShippingFee).HasPrecision(18, 2);
            entity.Property(o => o.TotalAmount).HasPrecision(18, 2);
            entity.Property(o => o.PointsDiscount).HasPrecision(18, 2);

            entity.HasOne(o => o.User)
                  .WithMany(u => u.Orders)
                  .HasForeignKey(o => o.UserId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<OrderItem>(entity =>
        {
            entity.HasKey(oi => oi.Id);
            entity.Property(oi => oi.UnitPrice).HasPrecision(18, 2);
            entity.HasOne(oi => oi.Order)
                  .WithMany(o => o.Items)
                  .HasForeignKey(oi => oi.OrderId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(oi => oi.Product)
                  .WithMany(p => p.OrderItems)
                  .HasForeignKey(oi => oi.ProductId)
                  .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<OrderStatusHistory>(entity =>
        {
            entity.HasKey(h => h.Id);
            entity.HasIndex(h => h.OrderId);
            entity.HasOne(h => h.Order)
                  .WithMany(o => o.StatusHistories)
                  .HasForeignKey(h => h.OrderId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Evaluation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.ProductId);
            entity.HasOne(e => e.Product)
                  .WithMany(p => p.Evaluations)
                  .HasForeignKey(e => e.ProductId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User)
                  .WithMany(u => u.Evaluations)
                  .HasForeignKey(e => e.UserId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PaymentTransaction>(entity =>
        {
            entity.HasKey(pt => pt.Id);
            entity.HasIndex(pt => pt.OrderCode);
            entity.Property(pt => pt.Amount).HasPrecision(18, 2);
            entity.HasOne(pt => pt.Order)
                  .WithMany(o => o.Transactions)
                  .HasForeignKey(pt => pt.OrderId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
