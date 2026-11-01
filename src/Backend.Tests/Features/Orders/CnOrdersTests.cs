using System.Text.RegularExpressions;
using DAFL.Backend.Features.Orders.CancelOrder;
using DAFL.Backend.Features.Orders.Checkout;
using DAFL.Backend.Features.Orders.GetOrderDetail;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Payments;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace DAFL.Backend.Tests.Features.Orders;

/// <summary>
/// Unit tests cho đặt hàng CN-07 (+ O1: voucher kiểm tra kỹ, phí ship 25.000đ / miễn phí ≥ 299.000đ tính trên tạm tính TRƯỚC giảm)
/// và đơn hàng CN-08 (chi tiết chỉ chủ đơn xem được, hủy đơn hoàn kho, hủy 2 lần không hoàn 2 lần).
/// Dùng SQLite in-memory (hỗ trợ transaction) như CheckoutHandlerTests.
/// </summary>
public class CnOrdersTests : IDisposable
{
    private static readonly Guid CheapProductId = TestConstants.TestProductId1;   // 100.000đ
    private static readonly Guid PriceyProductId = TestConstants.TestProductId2; // 34.990.000đ
    private static readonly Guid TinyProductId = Guid.Parse("55555555-5555-5555-5555-555555555555"); // 50.000đ

    private readonly SqliteConnection _connection;
    private readonly AppDbContext _context;

    public CnOrdersTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options;
        _context = new AppDbContext(options);
        _context.Database.EnsureCreated();

        _context.Users.Add(new User
        {
            Id = TestConstants.TestUserId,
            Email = "test@dafl.vn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Test@123"),
            FullName = "Test User",
            PhoneNumber = "0901234567",
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            EmailVerified = true
        });
        _context.Categories.Add(new Category
        {
            Id = TestConstants.TestCategoryId,
            Name = "Mỹ phẩm",
            Slug = "my-pham",
            CreatedAt = DateTime.UtcNow
        });
        _context.Products.AddRange(
            new Product
            {
                Id = CheapProductId, CategoryId = TestConstants.TestCategoryId, Name = "Son môi DAFL",
                Slug = "son-moi", Description = "Son", Price = 100000m, OriginalPrice = 120000m,
                Stock = 50, ReservedStock = 0, ImageUrl = "https://example.com/son.jpg", CreatedAt = DateTime.UtcNow
            },
            new Product
            {
                Id = PriceyProductId, CategoryId = TestConstants.TestCategoryId, Name = "Serum cao cấp",
                Slug = "serum", Description = "Serum", Price = 34990000m, OriginalPrice = 36990000m,
                Stock = 50, ReservedStock = 0, ImageUrl = "https://example.com/serum.jpg", CreatedAt = DateTime.UtcNow
            },
            new Product
            {
                Id = TinyProductId, CategoryId = TestConstants.TestCategoryId, Name = "Mặt nạ giấy",
                Slug = "mat-na", Description = "Mặt nạ", Price = 50000m, OriginalPrice = 60000m,
                Stock = 50, ReservedStock = 0, ImageUrl = "https://example.com/mask.jpg", CreatedAt = DateTime.UtcNow
            });
        _context.SaveChanges();
    }

    public void Dispose()
    {
        _context.Dispose();
        _connection.Dispose();
    }

    private CheckoutCommandHandler CreateCheckoutHandler()
    {
        var payOs = new Mock<IPayOSService>();
        payOs.Setup(s => s.CreatePaymentLinkAsync(It.IsAny<CreatePaymentLinkRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CreatePaymentLinkResponse(false, null, null, null, null, null, null, "Không dùng PayOS trong test COD"));

        var clients = new Mock<INotificationClient>();
        clients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
        var hubClients = new Mock<IHubClients<INotificationClient>>();
        hubClients.Setup(c => c.All).Returns(clients.Object);
        hubClients.Setup(c => c.Group(It.IsAny<string>())).Returns(clients.Object);
        var hub = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        hub.Setup(h => h.Clients).Returns(hubClients.Object);

        return new CheckoutCommandHandler(_context, payOs.Object, hub.Object, NullLogger<CheckoutCommandHandler>.Instance, new ConfigurationBuilder().Build());
    }

    private static CheckoutCommand CreateCodCommand(Guid productId, int quantity) => new(
        "Nguyen Van A",
        "test@dafl.vn",
        "0901234567",
        "123 Đường Kiểm Thử, Hà Nội",
        null,
        TestConstants.TestUserId,
        new List<CheckoutItemDto> { new(productId, quantity) });

    private async Task<Guid> CreateCodOrder(Guid productId, int quantity)
    {
        var result = await CreateCheckoutHandler().Handle(CreateCodCommand(productId, quantity), CancellationToken.None);
        result.Success.Should().BeTrue(result.Message);
        return result.Data!.OrderId;
    }

    #region CN-07: Đặt hàng COD

    /// <summary>
    /// TC-ORD-01: COD → trừ kho NGAY, mã đơn đúng định dạng DH{yyyyMMdd}-0001,
    /// phí ship 25.000đ khi tạm tính &lt; 299.000đ, trạng thái "Chờ xác nhận".
    /// </summary>
    [Fact]
    public async Task CodCheckout_DeductsStockImmediately_AndGeneratesDisplayCode()
    {
        var handler = CreateCheckoutHandler();

        var result = await handler.Handle(CreateCodCommand(CheapProductId, 2), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.PaymentMethod.Should().Be("COD");
        result.Data.ShippingFee.Should().Be(25000m); // 2 × 100.000 = 200.000 < 299.000
        result.Data.TotalAmount.Should().Be(225000m);
        Regex.IsMatch(result.Data.OrderDisplayCode!, @"^DH\d{8}-0001$").Should().BeTrue();

        var order = await _context.Orders.SingleAsync();
        order.Status.Should().Be(OrderStatus.Pending);
        order.StockDeducted.Should().BeTrue();
        order.OrderDisplayCode.Should().Be(result.Data.OrderDisplayCode);

        var product = await _context.Products.SingleAsync(p => p.Id == CheapProductId);
        product.Stock.Should().Be(48);
        product.ReservedStock.Should().Be(0);
    }

    /// <summary>
    /// TC-ORD-02: Tạm tính ≥ 299.000đ → phí ship 0đ.
    /// </summary>
    [Fact]
    public async Task CodCheckout_FreeShipping_WhenSubtotalReachesThreshold()
    {
        var result = await CreateCheckoutHandler().Handle(CreateCodCommand(PriceyProductId, 1), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.ShippingFee.Should().Be(0m);
        result.Data.TotalAmount.Should().Be(34990000m);
    }

    /// <summary>
    /// TC-ORD-03 (contract FE v4): Khối shipping lồng được ưu tiên để lưu snapshot Ship* trên đơn.
    /// </summary>
    [Fact]
    public async Task CodCheckout_NestedShippingBlock_WinsSnapshot()
    {
        var command = CreateCodCommand(CheapProductId, 1) with
        {
            Shipping = new ShippingInfoDto(
                "Người Nhận Khác", "0912345678",
                "79", "TP. Hồ Chí Minh", "760", "Quận 1", "26734", "Phường Bến Nghé",
                "Số 9 Đường Snapshot", "Giao giờ hành chính", null)
        };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        var order = await _context.Orders.SingleAsync();
        order.ShipProvinceName.Should().Be("TP. Hồ Chí Minh");
        order.ShipWardName.Should().Be("Phường Bến Nghé");
        order.ShipDetailAddress.Should().Be("Số 9 Đường Snapshot");
        order.ShipNote.Should().Be("Giao giờ hành chính");
        order.ShippingAddress.Should().Contain("Phường Bến Nghé");
        order.CustomerName.Should().Be("Người Nhận Khác");
    }

    /// <summary>
    /// TC-ORD-04: Chọn địa chỉ từ sổ địa chỉ (addressBookId) → snapshot lấy từ sổ, đơn cũ không đổi khi sửa sổ sau này.
    /// </summary>
    [Fact]
    public async Task CodCheckout_WithAddressBookId_UsesBookSnapshot()
    {
        var address = new UserAddress
        {
            Id = Guid.NewGuid(),
            UserId = TestConstants.TestUserId,
            RecipientName = "Chủ Sổ",
            Phone = "0901234567",
            ProvinceCode = "01", ProvinceName = "Hà Nội",
            DistrictCode = "001", DistrictName = "Ba Đình",
            WardCode = "00001", WardName = "Phường Phúc Xá",
            DetailAddress = "Số 5 Ngõ Sổ",
            IsDefault = true,
            CreatedAt = DateTime.UtcNow
        };
        _context.UserAddresses.Add(address);
        await _context.SaveChangesAsync();

        var command = new CheckoutCommand(
            "Nguyen Van A", "test@dafl.vn", "0901234567", null, null, TestConstants.TestUserId,
            new List<CheckoutItemDto> { new(CheapProductId, 1) },
            AddressBookId: address.Id);

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        var order = await _context.Orders.SingleAsync();
        order.AddressBookId.Should().Be(address.Id);
        order.ShipProvinceName.Should().Be("Hà Nội");
        order.ShipDetailAddress.Should().Be("Số 5 Ngõ Sổ");
    }

    /// <summary>
    /// TC-ORD-05: Đặt hàng xong → sản phẩm đã đặt bị xóa khỏi giỏ server của tài khoản.
    /// </summary>
    [Fact]
    public async Task CodCheckout_ClearsServerCart()
    {
        var cart = new DAFL.Backend.Infrastructure.Data.Cart
        {
            Id = Guid.NewGuid(),
            UserId = TestConstants.TestUserId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context.Carts.Add(cart);
        _context.CartItems.Add(new CartItem
        {
            Id = Guid.NewGuid(),
            CartId = cart.Id,
            ProductId = CheapProductId,
            UnitPrice = 100000m,
            Quantity = 2,
            AddedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await CreateCodOrder(CheapProductId, 2);

        (await _context.CartItems.CountAsync()).Should().Be(0);
    }

    /// <summary>
    /// TC-ORD-06 (CN-07 E5): Gửi trùng Idempotency-Key → trả lại đúng đơn cũ, không tạo đơn 2, không trừ kho 2 lần.
    /// </summary>
    [Fact]
    public async Task Checkout_SameIdempotencyKey_ReturnsSameOrder()
    {
        var handler = CreateCheckoutHandler();
        var command = CreateCodCommand(CheapProductId, 2) with { IdempotencyKey = "key-abc-123" };

        var first = await handler.Handle(command, CancellationToken.None);
        var second = await handler.Handle(command, CancellationToken.None);

        first.Success.Should().BeTrue();
        second.Success.Should().BeTrue();
        second.Data!.OrderId.Should().Be(first.Data!.OrderId);
        (await _context.Orders.CountAsync()).Should().Be(1);
        (await _context.Products.SingleAsync(p => p.Id == CheapProductId)).Stock.Should().Be(48);
    }

    /// <summary>
    /// TC-ORD-07: Đơn không có thông tin giao hàng nào (không khối lồng, không sổ, không địa chỉ phẳng) → bị từ chối rõ ràng.
    /// </summary>
    [Fact]
    public async Task Checkout_WithoutAnyShippingInfo_ShouldFail()
    {
        var command = new CheckoutCommand(
            "Nguyen Van A", "test@dafl.vn", "0901234567", null, null, TestConstants.TestUserId,
            new List<CheckoutItemDto> { new(CheapProductId, 1) });

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("địa chỉ giao hàng");
        (await _context.Orders.CountAsync()).Should().Be(0);
    }

    #endregion

    #region O1: Voucher kiểm tra kỹ ở BE

    private async Task AddVoucher(Voucher voucher)
    {
        _context.Vouchers.Add(voucher);
        await _context.SaveChangesAsync();
    }

    [Fact]
    public async Task Checkout_UnknownVoucherCode_ShouldFail()
    {
        var command = CreateCodCommand(CheapProductId, 1) with { VoucherCode = "KHONGTONTẠI" };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Mã giảm giá không tồn tại.");
    }

    [Fact]
    public async Task Checkout_InactiveVoucher_ShouldFail()
    {
        await AddVoucher(new Voucher
        {
            Id = Guid.NewGuid(), Code = "TATROI", Description = "Đã tắt", DiscountType = "Fixed",
            DiscountValue = 10000m, MinOrderAmount = 0m, IsActive = false
        });
        var command = CreateCodCommand(CheapProductId, 1) with { VoucherCode = "TATROI" };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Mã giảm giá đã hết hiệu lực.");
    }

    [Fact]
    public async Task Checkout_VoucherBelowMinSubtotal_ShouldFail()
    {
        await AddVoucher(new Voucher
        {
            Id = Guid.NewGuid(), Code = "MIN100K", Description = "Đơn tối thiểu 100k", DiscountType = "Fixed",
            DiscountValue = 10000m, MinOrderAmount = 100000m, IsActive = true
        });
        // Sản phẩm 50.000đ → tạm tính 50.000 < 100.000
        var command = CreateCodCommand(TinyProductId, 1) with { VoucherCode = "MIN100K" };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        // (Số tiền trong thông điệp được định dạng theo culture của máy chạy — chỉ chốt phần chữ cố định)
        result.Message.Should().Contain("Đơn hàng tối thiểu cần đạt").And.Contain("để áp dụng mã MIN100K");
    }

    [Fact]
    public async Task Checkout_VoucherMaxUsesExhausted_ShouldFail()
    {
        await AddVoucher(new Voucher
        {
            Id = Guid.NewGuid(), Code = "HETLUOT", Description = "Hết lượt", DiscountType = "Fixed",
            DiscountValue = 10000m, MinOrderAmount = 0m, IsActive = true, MaxUses = 5, UsedCount = 5
        });
        var command = CreateCodCommand(CheapProductId, 1) with { VoucherCode = "HETLUOT" };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Mã giảm giá đã hết lượt sử dụng.");
    }

    /// <summary>
    /// TC-ORD-08: Voucher % hợp lệ → giảm đúng, UsedCount tăng trong cùng transaction,
    /// phí ship tính trên tạm tính TRƯỚC giảm (200.000đ &lt; 299.000đ → vẫn thu 25.000đ dù sau giảm còn 180.000đ).
    /// </summary>
    [Fact]
    public async Task Checkout_ValidPercentageVoucher_AppliesDiscountAndIncrementsUsedCount()
    {
        await AddVoucher(new Voucher
        {
            Id = Guid.NewGuid(), Code = "GIAM10", Description = "Giảm 10%", DiscountType = "Percentage",
            DiscountValue = 10m, MinOrderAmount = 0m, MaxDiscountAmount = 500000m, IsActive = true, MaxUses = 10, UsedCount = 0
        });
        var command = CreateCodCommand(CheapProductId, 2) with { VoucherCode = "GIAM10" };

        var result = await CreateCheckoutHandler().Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.DiscountAmount.Should().Be(20000m);
        result.Data.ShippingFee.Should().Be(25000m);
        result.Data.TotalAmount.Should().Be(205000m);

        var voucher = await _context.Vouchers.SingleAsync(v => v.Code == "GIAM10");
        voucher.UsedCount.Should().Be(1);
        var order = await _context.Orders.SingleAsync();
        order.VoucherCode.Should().Be("GIAM10");
        order.DiscountAmount.Should().Be(20000m);
    }

    #endregion

    #region CN-08: Chi tiết + hủy đơn

    /// <summary>
    /// TC-ORD-09: Chi tiết đơn — chủ đơn xem được (kèm nhãn trạng thái tiếng Việt + mã đơn DH),
    /// người khác xem → Data null (endpoint trả 404).
    /// </summary>
    [Fact]
    public async Task GetOrderDetail_OnlyOwnerCanView()
    {
        var orderId = await CreateCodOrder(CheapProductId, 1);
        var handler = new GetOrderDetailQueryHandler(_context);

        var own = await handler.Handle(new GetOrderDetailQuery(TestConstants.TestUserId, orderId), CancellationToken.None);
        own.Data.Should().NotBeNull();
        own.Data!.StatusLabel.Should().Be("Chờ xác nhận");
        own.Data.OrderDisplayCode.Should().StartWith("DH");

        var others = await handler.Handle(new GetOrderDetailQuery(Guid.NewGuid(), orderId), CancellationToken.None);
        others.Data.Should().BeNull();
    }

    /// <summary>
    /// TC-ORD-10: Hủy đơn COD ở "Chờ xác nhận" → Đã hủy + lưu lý do + hoàn kho;
    /// hủy lần 2 → "Đơn không còn có thể hủy" và KHÔNG hoàn kho lần nữa.
    /// </summary>
    [Fact]
    public async Task Cancel_CodOrder_RestocksOnce_SecondCancelFails()
    {
        var orderId = await CreateCodOrder(CheapProductId, 2);
        (await _context.Products.SingleAsync(p => p.Id == CheapProductId)).Stock.Should().Be(48);

        var cancelHandler = new CancelOrderCommandHandler(_context);
        var cancel = await cancelHandler.Handle(
            new CancelOrderCommand(TestConstants.TestUserId, orderId, "Đổi ý không mua nữa"), CancellationToken.None);

        cancel.Success.Should().BeTrue();
        var order = await _context.Orders.SingleAsync();
        order.Status.Should().Be(OrderStatus.Cancelled);
        order.CancelReason.Should().Be("Đổi ý không mua nữa");
        order.CancelledAt.Should().NotBeNull();
        (await _context.Products.SingleAsync(p => p.Id == CheapProductId)).Stock.Should().Be(50);

        var second = await cancelHandler.Handle(
            new CancelOrderCommand(TestConstants.TestUserId, orderId, "Hủy lại"), CancellationToken.None);
        second.Success.Should().BeFalse();
        second.Message.Should().Be("Đơn không còn có thể hủy");
        (await _context.Products.SingleAsync(p => p.Id == CheapProductId)).Stock.Should().Be(50);
    }

    /// <summary>
    /// TC-ORD-11 (CN-08 E3): Hủy đơn của người khác → từ chối quyền, đơn không đổi.
    /// </summary>
    [Fact]
    public async Task Cancel_OthersOrder_ShouldFail()
    {
        var orderId = await CreateCodOrder(CheapProductId, 1);

        var cancelHandler = new CancelOrderCommandHandler(_context);
        var result = await cancelHandler.Handle(
            new CancelOrderCommand(Guid.NewGuid(), orderId, "Hủy hộ"), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Không có quyền");
        (await _context.Orders.SingleAsync()).Status.Should().Be(OrderStatus.Pending);
    }

    /// <summary>
    /// TC-ORD-12: Danh sách đơn của tôi — lọc theo nhãn trạng thái tiếng Việt hoạt động.
    /// </summary>
    [Fact]
    public async Task OrderHistory_FilterByVietnameseStatusLabel()
    {
        await CreateCodOrder(CheapProductId, 1);
        var handler = new GetOrderHistoryQueryHandler(_context);

        var pending = await handler.Handle(
            new GetOrderHistoryQuery(TestConstants.TestUserId, null, 1, 12, "Chờ xác nhận"), CancellationToken.None);
        pending.Data.Should().HaveCount(1);
        pending.Data![0].StatusLabel.Should().Be("Chờ xác nhận");

        var cancelled = await handler.Handle(
            new GetOrderHistoryQuery(TestConstants.TestUserId, null, 1, 12, "Đã hủy"), CancellationToken.None);
        cancelled.Data.Should().BeEmpty();
    }

    #endregion
}
