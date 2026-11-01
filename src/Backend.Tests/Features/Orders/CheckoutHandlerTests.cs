using DAFL.Backend.Features.Orders.Checkout;
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
/// Unit tests cho CheckoutCommandHandler.
/// Dùng SQLite in-memory (hỗ trợ transaction) thay cho EF InMemory provider.
/// </summary>
public class CheckoutHandlerTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly AppDbContext _context;

    public CheckoutHandlerTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options;
        _context = new AppDbContext(options);
        _context.Database.EnsureCreated();

        _context.Categories.Add(new Category
        {
            Id = TestConstants.TestCategoryId,
            Name = "Điện thoại",
            Slug = "dien-thoai",
            CreatedAt = DateTime.UtcNow
        });
        _context.Products.Add(new Product
        {
            Id = TestConstants.TestProductId1,
            CategoryId = TestConstants.TestCategoryId,
            Name = "iPhone 15 Pro Max",
            Slug = "iphone-15-pro-max",
            Description = "Điện thoại Apple mới nhất",
            Price = 34990000m,
            OriginalPrice = 36990000m,
            Stock = 50,
            ReservedStock = 0,
            ImageUrl = "https://example.com/iphone15.jpg",
            CreatedAt = DateTime.UtcNow
        });
        _context.SaveChanges();
    }

    private CheckoutCommandHandler CreateHandler(CreatePaymentLinkResponse payOsResponse)
    {
        var payOs = new Mock<IPayOSService>();
        payOs.Setup(s => s.CreatePaymentLinkAsync(It.IsAny<CreatePaymentLinkRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(payOsResponse);

        var clients = new Mock<IHubClients<INotificationClient>>();
        clients.Setup(c => c.All).Returns(Mock.Of<INotificationClient>());
        var hub = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        hub.Setup(h => h.Clients).Returns(clients.Object);

        return new CheckoutCommandHandler(_context, payOs.Object, hub.Object, NullLogger<CheckoutCommandHandler>.Instance, new ConfigurationBuilder().Build());
    }

    // Mặc định PaymentMethod = "COD" (CN-07); hai test PayOS dưới đây ghi đè thành "PayOS"
    private static CheckoutCommand CreateCommand() => new(
        "Nguyen Van A",
        "test@dafl.vn",
        "0901234567",
        "123 Test Street",
        null,
        null,
        new List<CheckoutItemDto> { new(TestConstants.TestProductId1, 2) });

    /// <summary>
    /// TC-CHKH-01: PayOS tạo link thành công → đơn hàng được lưu và kho được giữ chỗ.
    /// </summary>
    [Fact]
    public async Task Handle_WhenPayOsSucceeds_ShouldPersistOrderAndReserveStock()
    {
        var handler = CreateHandler(new CreatePaymentLinkResponse(
            true, "https://pay.example/checkout", "qr", "0987654321", "DAFL STORE", 970422, "DH", "Success"));

        var result = await handler.Handle(CreateCommand() with { PaymentMethod = "PayOS" }, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.CheckoutUrl.Should().Be("https://pay.example/checkout");
        (await _context.Orders.CountAsync()).Should().Be(1);
        (await _context.Products.SingleAsync()).ReservedStock.Should().Be(2);
    }

    /// <summary>
    /// TC-CHKH-02: PayOS trả lỗi → Checkout phải thất bại, không lưu đơn "ma" và không giữ chỗ kho.
    /// </summary>
    [Fact]
    public async Task Handle_WhenPayOsFails_ShouldFailAndRollbackOrderAndReservation()
    {
        var handler = CreateHandler(new CreatePaymentLinkResponse(
            false, null, null, null, null, null, null, "PayOS request failed"));

        var result = await handler.Handle(CreateCommand() with { PaymentMethod = "PayOS" }, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Không thể tạo link thanh toán");

        _context.ChangeTracker.Clear();
        (await _context.Orders.CountAsync()).Should().Be(0);
        (await _context.Products.SingleAsync()).ReservedStock.Should().Be(0);
    }

    /// <summary>
    /// TC-CHKH-03 (O1 — voucher kiểm tra kỹ ở BE): Voucher đã hết hạn → checkout THẤT BẠI toàn bộ
    /// với thông điệp riêng, không tạo đơn (bản cũ bỏ qua voucher và vẫn tạo đơn — đã sửa theo O1).
    /// </summary>
    [Fact]
    public async Task Handle_WithExpiredVoucher_ShouldNotApplyDiscount()
    {
        _context.Vouchers.Add(new Voucher
        {
            Id = Guid.NewGuid(),
            Code = "EXPIRED50",
            Description = "Hết hạn",
            DiscountType = "Percentage",
            DiscountValue = 50m,
            MinOrderAmount = 0m,
            ExpiryDate = DateTime.UtcNow.AddDays(-1),
            IsActive = true
        });
        _context.SaveChanges();
        var handler = CreateHandler(new CreatePaymentLinkResponse(true, "https://pay.example/checkout", null, null, null, null, "DH", "Success"));
        var command = CreateCommand() with { VoucherCode = "EXPIRED50" };

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("hết hạn");
        (await _context.Orders.CountAsync()).Should().Be(0);
    }

    public void Dispose()
    {
        _context.Dispose();
        _connection.Dispose();
    }
}
