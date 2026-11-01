using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Payments;
using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders.Checkout;

public record CheckoutItemDto(Guid ProductId, int Quantity);

/// <summary>
/// Khối thông tin giao hàng cấu trúc do FE gửi lồng trong payload đặt hàng (Mục 7B — bản chốt v4).
/// Khi có khối này, BE ƯU TIÊN dùng nó (thay cho các trường phẳng Customer*/ShippingAddress):
/// người nhận/SĐT lấy từ RecipientName/Phone nếu có, địa chỉ hiển thị do BE tự ghép,
/// và toàn bộ trường được lưu snapshot bất biến vào đơn (các cột Ship* + AddressBookId).
/// </summary>
public record ShippingInfoDto(
    string? RecipientName,
    string? Phone,
    string? ProvinceCode,
    string? ProvinceName,
    string? DistrictCode,
    string? DistrictName,
    string? WardCode,
    string? WardName,
    string? DetailAddress,
    string? Note,
    Guid? AddressBookId);

public record CheckoutCommand(
    string CustomerName,
    string CustomerEmail,
    string CustomerPhone,
    string? ShippingAddress,
    string? VoucherCode,
    Guid? UserId,
    List<CheckoutItemDto> Items,
    ShippingInfoDto? Shipping = null,
    string PaymentMethod = "COD",
    string? OrderNote = null,
    Guid? AddressBookId = null,
    string? IdempotencyKey = null) : IRequest<ApiResponse<CheckoutResultDto>>;

public record CheckoutResultDto(
    Guid OrderId,
    long OrderCode,
    decimal SubTotal,
    decimal DiscountAmount,
    decimal TotalAmount,
    string? CheckoutUrl,
    string? QrCode,
    string? AccountNumber,
    string? AccountName,
    int? Bin,
    string? PaymentDescription,
    DateTime ExpiresAt,
    string? OrderDisplayCode,
    string PaymentMethod,
    decimal ShippingFee);

public class CheckoutCommandValidator : AbstractValidator<CheckoutCommand>
{
    public CheckoutCommandValidator()
    {
        RuleFor(x => x.CustomerName).NotEmpty().WithMessage("Tên khách hàng không được để trống.");
        RuleFor(x => x.CustomerEmail).NotEmpty().EmailAddress().WithMessage("Email không hợp lệ.");
        RuleFor(x => x.CustomerPhone).NotEmpty().WithMessage("Số điện thoại không được để trống.");
        RuleFor(x => x.Items).NotEmpty().WithMessage("Giỏ hàng không có sản phẩm.");
        RuleFor(x => x.PaymentMethod)
            .Must(m => m == "COD" || m == "PayOS")
            .WithMessage("Phương thức thanh toán không hợp lệ.");
        RuleFor(x => x.OrderNote)
            .MaximumLength(200).WithMessage("Ghi chú đơn hàng tối đa 200 ký tự.");
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.ProductId).NotEmpty();
            item.RuleFor(i => i.Quantity).GreaterThan(0).WithMessage("Số lượng phải lớn hơn 0.");
        });

        // Khi FE gửi khối shipping lồng: validate đầy đủ theo Mục 7B (bắt buộc chọn đủ 3 cấp
        // Tỉnh/Quận/Phường từ dữ liệu tĩnh, địa chỉ chi tiết ≥ 5 ký tự, ghi chú ≤ 500 ký tự).
        When(x => x.Shipping != null, () =>
        {
            RuleFor(x => x.Shipping!.ProvinceCode).NotEmpty().WithMessage("Vui lòng chọn tỉnh/thành phố.");
            RuleFor(x => x.Shipping!.ProvinceName).NotEmpty().WithMessage("Vui lòng chọn tỉnh/thành phố.");
            RuleFor(x => x.Shipping!.DistrictCode).NotEmpty().WithMessage("Vui lòng chọn quận/huyện.");
            RuleFor(x => x.Shipping!.DistrictName).NotEmpty().WithMessage("Vui lòng chọn quận/huyện.");
            RuleFor(x => x.Shipping!.WardCode).NotEmpty().WithMessage("Vui lòng chọn phường/xã.");
            RuleFor(x => x.Shipping!.WardName).NotEmpty().WithMessage("Vui lòng chọn phường/xã.");
            RuleFor(x => x.Shipping!.DetailAddress)
                .NotEmpty().WithMessage("Vui lòng nhập địa chỉ chi tiết.")
                .MinimumLength(5).WithMessage("Địa chỉ chi tiết phải có ít nhất 5 ký tự.");
            RuleFor(x => x.Shipping!.Note)
                .MaximumLength(500).WithMessage("Ghi chú giao hàng tối đa 500 ký tự.");
            RuleFor(x => x.Shipping!.RecipientName)
                .MinimumLength(2).When(x => !string.IsNullOrWhiteSpace(x.Shipping!.RecipientName))
                .WithMessage("Tên người nhận phải có ít nhất 2 ký tự.");
            RuleFor(x => x.Shipping!.Phone)
                .Matches(@"^0\d{9}$").When(x => !string.IsNullOrWhiteSpace(x.Shipping!.Phone))
                .WithMessage("Số điện thoại người nhận không hợp lệ. Vui lòng nhập số điện thoại Việt Nam gồm 10 chữ số và bắt đầu bằng số 0.");
        });
    }
}

/// <summary>
/// Đặt hàng theo CN-07 + override O1:
/// - Phương thức COD (trừ kho ngay, trạng thái Chờ xác nhận) hoặc PayOS (giữ kho 15 phút, webhook xác nhận mới trừ kho).
/// - Phí ship giữ quy tắc hiện hành của app: 25.000đ, miễn phí khi TẠM TÍNH (trước giảm giá) ≥ 299.000đ.
/// - Voucher được BE kiểm tra lại toàn bộ khi đặt hàng: tồn tại / còn active / chưa hết hạn / đạt đơn tối thiểu / còn lượt dùng;
///   FREESHIP miễn phí vận chuyển; FORDEV đưa tổng thanh toán về đúng 2.000đ (phục vụ test PayOS).
/// - Mã đơn hiển thị DH{yyyyMMdd}-{seq 4 số}; chống double-submit bằng IdempotencyKey (unique).
/// - Đơn lưu snapshot địa chỉ giao hàng (Ship*) + snapshot giá từng sản phẩm.
/// </summary>
public class CheckoutCommandHandler : IRequestHandler<CheckoutCommand, ApiResponse<CheckoutResultDto>>
{
    public const decimal ShippingFeeAmount = 25000m;
    public const decimal FreeShippingThreshold = 299000m;

    private readonly AppDbContext _context;
    private readonly IPayOSService _payOSService;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;
    private readonly ILogger<CheckoutCommandHandler> _logger;
    private readonly string _frontendBaseUrl;

    public CheckoutCommandHandler(
        AppDbContext context,
        IPayOSService payOSService,
        IHubContext<NotificationHub, INotificationClient> hubContext,
        ILogger<CheckoutCommandHandler> logger,
        IConfiguration configuration)
    {
        _context = context;
        _payOSService = payOSService;
        _hubContext = hubContext;
        _logger = logger;
        _frontendBaseUrl = (configuration["Frontend:BaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
    }

    public async Task<ApiResponse<CheckoutResultDto>> Handle(CheckoutCommand request, CancellationToken cancellationToken)
    {
        var paymentMethod = string.Equals(request.PaymentMethod, "PayOS", StringComparison.OrdinalIgnoreCase) ? "PayOS" : "COD";
        var isPayOs = paymentMethod == "PayOS";

        // CN-07 E5: gửi trùng Idempotency-Key → trả lại đúng đơn đã tạo, không tạo đơn thứ hai
        if (!string.IsNullOrWhiteSpace(request.IdempotencyKey))
        {
            var existingOrder = await _context.Orders
                .AsNoTracking()
                .FirstOrDefaultAsync(o => o.IdempotencyKey == request.IdempotencyKey, cancellationToken);
            if (existingOrder != null)
            {
                return ApiResponse<CheckoutResultDto>.Ok(ToResultDto(existingOrder), "Đơn hàng đã được tạo trước đó.");
            }
        }

        var strategy = _context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            var orderCode = long.Parse(DateTime.UtcNow.ToString("yyMMdd") + new Random().Next(1000, 9999));

            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                // --- 1. Kiểm tra lại từng sản phẩm: còn bán, đủ tồn kho, giá hiện tại (CN-07) ---
                decimal subTotal = 0;
                var orderItems = new List<OrderItem>();
                var paymentItems = new List<PaymentItemRequest>();
                var orderId = Guid.NewGuid();

                foreach (var itemReq in request.Items)
                {
                    var product = await _context.Products.FirstOrDefaultAsync(p => p.Id == itemReq.ProductId, cancellationToken);
                    if (product == null)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail($"Sản phẩm mã {itemReq.ProductId} không tồn tại.");
                    }

                    if (!product.IsActive)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail($"Sản phẩm '{product.Name}' đã ngừng bán, vui lòng xóa khỏi giỏ hàng.");
                    }

                    var availableStock = product.Stock - product.ReservedStock;
                    if (availableStock < itemReq.Quantity)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail($"Sản phẩm '{product.Name}' chỉ còn {availableStock} món, không đủ {itemReq.Quantity} món đặt mua.");
                    }

                    if (isPayOs)
                    {
                        // PayOS: giữ chỗ kho 15 phút, webhook/thanh toán thành công mới trừ thật
                        product.ReservedStock += itemReq.Quantity;
                    }
                    else
                    {
                        // COD (CN-07): trừ tồn kho ngay trong transaction tạo đơn
                        product.Stock -= itemReq.Quantity;
                    }

                    var itemTotal = product.Price * itemReq.Quantity;
                    subTotal += itemTotal;

                    orderItems.Add(new OrderItem
                    {
                        Id = Guid.NewGuid(),
                        OrderId = orderId,
                        ProductId = product.Id,
                        ProductName = product.Name,
                        ProductImageUrl = product.ImageUrl,
                        UnitPrice = product.Price,
                        Quantity = itemReq.Quantity
                    });

                    paymentItems.Add(new PaymentItemRequest(product.Name, itemReq.Quantity, product.Price));
                }

                // --- 2. Phí vận chuyển (O1): tính trên tạm tính TRƯỚC giảm giá ---
                var shippingFee = subTotal >= FreeShippingThreshold ? 0m : ShippingFeeAmount;

                // --- 3. Voucher: BE kiểm tra lại toàn bộ, mỗi trường hợp lỗi một thông điệp riêng (O1) ---
                decimal discountAmount = 0;
                string? validVoucherCode = null;
                Voucher? appliedVoucher = null;

                if (!string.IsNullOrWhiteSpace(request.VoucherCode))
                {
                    var vCode = request.VoucherCode.Trim().ToUpperInvariant();
                    var voucher = await _context.Vouchers.FirstOrDefaultAsync(v => v.Code == vCode, cancellationToken);

                    if (voucher == null)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail("Mã giảm giá không tồn tại.");
                    }

                    if (!voucher.IsActive)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail("Mã giảm giá đã hết hiệu lực.");
                    }

                    if (voucher.ExpiryDate.HasValue && voucher.ExpiryDate.Value <= DateTime.UtcNow)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail("Mã giảm giá đã hết hạn sử dụng.");
                    }

                    if (subTotal < voucher.MinOrderAmount)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail($"Đơn hàng tối thiểu cần đạt {voucher.MinOrderAmount:N0}đ để áp dụng mã {voucher.Code}.");
                    }

                    if (voucher.MaxUses.HasValue && voucher.UsedCount >= voucher.MaxUses.Value)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return ApiResponse<CheckoutResultDto>.Fail("Mã giảm giá đã hết lượt sử dụng.");
                    }

                    appliedVoucher = voucher;
                    validVoucherCode = voucher.Code;

                    if (voucher.Code == "FORDEV")
                    {
                        // Mã test PayOS: tổng thanh toán (kể cả phí ship) đưa về đúng 2.000đ
                        discountAmount = Math.Max(0, subTotal + shippingFee - 2000m);
                    }
                    else if (voucher.Code == "FREESHIP" || voucher.DiscountType == "FreeShip")
                    {
                        // FREESHIP: miễn phí vận chuyển, không giảm trực tiếp vào tạm tính
                        shippingFee = 0;
                    }
                    else if (voucher.DiscountType == "Percentage")
                    {
                        discountAmount = subTotal * (voucher.DiscountValue / 100m);
                        if (voucher.MaxDiscountAmount.HasValue && discountAmount > voucher.MaxDiscountAmount.Value)
                        {
                            discountAmount = voucher.MaxDiscountAmount.Value;
                        }
                    }
                    else
                    {
                        discountAmount = voucher.DiscountValue;
                    }

                    if (discountAmount > subTotal)
                    {
                        discountAmount = subTotal;
                    }
                }

                var totalAmount = subTotal - discountAmount + shippingFee;

                // --- 4. Snapshot giao hàng: ưu tiên khối shipping lồng → địa chỉ trong sổ → địa chỉ phẳng cũ ---
                var snapshot = await ResolveShippingSnapshotAsync(request, cancellationToken);
                if (snapshot == null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return ApiResponse<CheckoutResultDto>.Fail("Vui lòng chọn hoặc thêm địa chỉ giao hàng trước khi đặt hàng.");
                }

                // --- 5. Tạo đơn + mã hiển thị DH{yyyyMMdd}-{seq} ---
                var now = DateTime.UtcNow;
                var displayPrefix = $"DH{now:yyyyMMdd}-";
                var todayCount = await _context.Orders.CountAsync(o => o.OrderDisplayCode != null && o.OrderDisplayCode.StartsWith(displayPrefix), cancellationToken);
                var orderDisplayCode = $"{displayPrefix}{todayCount + 1:D4}";
                var expiresAt = isPayOs ? now.AddMinutes(15) : now.AddYears(1);

                var order = new Order
                {
                    Id = orderId,
                    OrderCode = orderCode,
                    OrderDisplayCode = orderDisplayCode,
                    PaymentMethod = paymentMethod,
                    ShippingFee = shippingFee,
                    IdempotencyKey = string.IsNullOrWhiteSpace(request.IdempotencyKey) ? null : request.IdempotencyKey,
                    StockDeducted = !isPayOs,
                    UserId = request.UserId,
                    CustomerName = snapshot.Value.RecipientName,
                    CustomerEmail = request.CustomerEmail,
                    CustomerPhone = snapshot.Value.Phone,
                    ShippingAddress = snapshot.Value.ComposedAddress,
                    ShipProvinceCode = snapshot.Value.ProvinceCode,
                    ShipProvinceName = snapshot.Value.ProvinceName,
                    ShipDistrictCode = snapshot.Value.DistrictCode,
                    ShipDistrictName = snapshot.Value.DistrictName,
                    ShipWardCode = snapshot.Value.WardCode,
                    ShipWardName = snapshot.Value.WardName,
                    ShipDetailAddress = snapshot.Value.DetailAddress,
                    ShipNote = snapshot.Value.Note,
                    AddressBookId = snapshot.Value.AddressBookId,
                    SubTotal = subTotal,
                    DiscountAmount = discountAmount,
                    VoucherCode = validVoucherCode,
                    TotalAmount = totalAmount,
                    Status = OrderStatus.Pending,
                    CreatedAt = now,
                    ExpiresAt = expiresAt,
                    Items = orderItems
                };

                var history = new OrderStatusHistory
                {
                    Id = Guid.NewGuid(),
                    OrderId = orderId,
                    Status = OrderStatus.Pending,
                    Note = isPayOs
                        ? "Khởi tạo đơn hàng - Giữ chỗ kho 15 phút - Chờ thanh toán PayOS"
                        : "Đặt hàng COD - Chờ xác nhận",
                    Timestamp = now
                };

                await _context.Orders.AddAsync(order, cancellationToken);
                await _context.OrderStatusHistories.AddAsync(history, cancellationToken);

                // Tăng lượt dùng voucher trong cùng transaction (O1)
                if (appliedVoucher != null)
                {
                    appliedVoucher.UsedCount++;
                }

                // CN-07: xóa các sản phẩm đã đặt khỏi giỏ server của tài khoản
                if (request.UserId.HasValue)
                {
                    var cart = await _context.Carts
                        .Include(c => c.Items)
                        .FirstOrDefaultAsync(c => c.UserId == request.UserId.Value, cancellationToken);
                    if (cart != null)
                    {
                        var orderedProductIds = request.Items.Select(i => i.ProductId).ToHashSet();
                        var toRemove = cart.Items.Where(ci => orderedProductIds.Contains(ci.ProductId)).ToList();
                        if (toRemove.Count > 0)
                        {
                            _context.CartItems.RemoveRange(toRemove);
                            cart.UpdatedAt = now;
                        }
                    }
                }

                await _context.SaveChangesAsync(cancellationToken);

                // --- 6. PayOS: tạo link thanh toán; lỗi → rollback toàn bộ (không để đơn "ma") ---
                string? checkoutUrl = null;
                CreatePaymentLinkResponse? payOsResponse = null;
                if (isPayOs)
                {
                    var linkItems = (discountAmount > 0 || shippingFee > 0)
                        ? new List<PaymentItemRequest> { new($"Đơn hàng {orderDisplayCode}", 1, totalAmount) }
                        : paymentItems;

                    var returnUrl = $"{_frontendBaseUrl}/payment-success?orderCode={orderCode}";
                    var cancelUrl = $"{_frontendBaseUrl}/cart?orderCode={orderCode}";

                    payOsResponse = await _payOSService.CreatePaymentLinkAsync(new CreatePaymentLinkRequest(
                        orderCode,
                        totalAmount,
                        $"DH {orderCode}",
                        returnUrl,
                        cancelUrl,
                        linkItems), cancellationToken);

                    if (!payOsResponse.Success || string.IsNullOrEmpty(payOsResponse.CheckoutUrl))
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        _logger.LogWarning("PayOS không tạo được link thanh toán cho đơn {OrderDisplayCode}: {Reason}", orderDisplayCode, payOsResponse.Message);
                        return ApiResponse<CheckoutResultDto>.Fail("Không thể tạo link thanh toán PayOS: " + (payOsResponse.Message ?? "lỗi không xác định"));
                    }

                    checkoutUrl = payOsResponse.CheckoutUrl;
                    order.PayOSCheckoutUrl = checkoutUrl;
                    await _context.SaveChangesAsync(cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);

                // --- 7. Thông báo real-time ---
                var notif = new
                {
                    Title = "Đơn hàng mới " + orderDisplayCode,
                    Message = $"Đơn hàng {orderDisplayCode} đã được tạo thành công với số tiền {totalAmount:N0}đ.",
                    Type = "Order",
                    CreatedAt = DateTime.UtcNow
                };
                if (request.UserId.HasValue)
                {
                    await _hubContext.Clients.Group(NotificationGroups.ForUser(request.UserId.Value)).ReceiveNotification(notif);
                }
                await _hubContext.Clients.All.ReceiveOrderStatusUpdate(orderCode, "Pending",
                    isPayOs ? "Đơn hàng đang chờ thanh toán" : "Đơn hàng đang chờ xác nhận");

                _logger.LogInformation("Order {OrderDisplayCode} (#{OrderCode}) created via {PaymentMethod}. Total: {Total}", orderDisplayCode, orderCode, paymentMethod, totalAmount);

                return ApiResponse<CheckoutResultDto>.Ok(new CheckoutResultDto(
                    orderId,
                    orderCode,
                    subTotal,
                    discountAmount,
                    totalAmount,
                    checkoutUrl,
                    payOsResponse?.QrCode,
                    payOsResponse?.AccountNumber,
                    payOsResponse?.AccountName,
                    payOsResponse?.Bin,
                    payOsResponse?.Description,
                    expiresAt,
                    orderDisplayCode,
                    paymentMethod,
                    shippingFee),
                    isPayOs ? "Tạo đơn hàng và link thanh toán PayOS thành công." : "Đặt hàng thành công");
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync(cancellationToken);
                _logger.LogError(ex, "Lỗi trong quá trình tạo đơn hàng: {Message}", ex.Message);
                return ApiResponse<CheckoutResultDto>.Fail("Không thể khởi tạo đơn hàng: " + ex.Message);
            }
        });
    }

    private CheckoutResultDto ToResultDto(Order order) => new(
        order.Id,
        order.OrderCode,
        order.SubTotal,
        order.DiscountAmount,
        order.TotalAmount,
        order.PayOSCheckoutUrl,
        null, null, null, null, null,
        order.ExpiresAt,
        order.OrderDisplayCode,
        order.PaymentMethod,
        order.ShippingFee);

    private readonly record struct ShippingSnapshot(
        string RecipientName,
        string Phone,
        string ComposedAddress,
        string? ProvinceCode,
        string? ProvinceName,
        string? DistrictCode,
        string? DistrictName,
        string? WardCode,
        string? WardName,
        string? DetailAddress,
        string? Note,
        Guid? AddressBookId);

    /// <summary>
    /// Xác định thông tin giao hàng để snapshot vào đơn:
    /// 1) Khối shipping lồng của FE (ưu tiên cao nhất) → 2) AddressBookId trỏ tới sổ địa chỉ của chính user →
    /// 3) Địa chỉ phẳng cũ (ShippingAddress text) cho tương thích. Không có nguồn nào → null (CN-07 E3).
    /// Ghi chú đơn hàng (OrderNote ≤ 200 ký tự) được nối vào ShipNote nếu khối shipping không có ghi chú riêng.
    /// </summary>
    private async Task<ShippingSnapshot?> ResolveShippingSnapshotAsync(CheckoutCommand request, CancellationToken cancellationToken)
    {
        var ship = request.Shipping;
        if (ship != null)
        {
            var composed = string.Join(", ", new[]
            {
                ship.DetailAddress?.Trim(),
                ship.WardName?.Trim(),
                ship.DistrictName?.Trim(),
                ship.ProvinceName?.Trim()
            }.Where(part => !string.IsNullOrWhiteSpace(part)));

            return new ShippingSnapshot(
                !string.IsNullOrWhiteSpace(ship.RecipientName) ? ship.RecipientName!.Trim() : request.CustomerName,
                !string.IsNullOrWhiteSpace(ship.Phone) ? ship.Phone!.Trim() : request.CustomerPhone,
                composed,
                ship.ProvinceCode?.Trim(),
                ship.ProvinceName?.Trim(),
                ship.DistrictCode?.Trim(),
                ship.DistrictName?.Trim(),
                ship.WardCode?.Trim(),
                ship.WardName?.Trim(),
                ship.DetailAddress?.Trim(),
                !string.IsNullOrWhiteSpace(ship.Note) ? ship.Note!.Trim() : request.OrderNote?.Trim(),
                ship.AddressBookId);
        }

        var addressBookId = request.AddressBookId;
        if (addressBookId.HasValue && request.UserId.HasValue)
        {
            var address = await _context.UserAddresses
                .AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == addressBookId.Value && a.UserId == request.UserId.Value, cancellationToken);
            if (address != null)
            {
                var composed = string.Join(", ", new[]
                {
                    address.DetailAddress,
                    address.WardName,
                    address.DistrictName,
                    address.ProvinceName
                }.Where(part => !string.IsNullOrWhiteSpace(part)));

                return new ShippingSnapshot(
                    address.RecipientName,
                    address.Phone,
                    composed,
                    address.ProvinceCode,
                    address.ProvinceName,
                    address.DistrictCode,
                    address.DistrictName,
                    address.WardCode,
                    address.WardName,
                    address.DetailAddress,
                    !string.IsNullOrWhiteSpace(address.Note) ? address.Note : request.OrderNote?.Trim(),
                    address.Id);
            }
        }

        if (!string.IsNullOrWhiteSpace(request.ShippingAddress))
        {
            return new ShippingSnapshot(
                request.CustomerName,
                request.CustomerPhone,
                request.ShippingAddress,
                null, null, null, null, null, null, null,
                request.OrderNote?.Trim(),
                null);
        }

        return null;
    }
}
