using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Tests.Helpers;

/// <summary>
/// Factory tạo AppDbContext sử dụng EF Core InMemory Database cho unit test.
/// Mỗi test sẽ có database riêng biệt để đảm bảo tính cô lập (isolation).
/// </summary>
public static class TestDbContextFactory
{
    /// <summary>
    /// Tạo AppDbContext InMemory mới với tên database ngẫu nhiên.
    /// Đảm bảo mỗi test case có database riêng, không bị ảnh hưởng bởi test khác.
    /// </summary>
    public static AppDbContext Create()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: $"DAFL_TestDb_{Guid.NewGuid()}")
            .Options;

        var context = new AppDbContext(options);
        context.Database.EnsureCreated();
        return context;
    }

    /// <summary>
    /// Tạo AppDbContext InMemory với dữ liệu mẫu (seed data) được thiết lập sẵn.
    /// Bao gồm: User, Category, Product, Voucher cho các test case cần dữ liệu.
    /// </summary>
    public static AppDbContext CreateWithSeedData()
    {
        var context = Create();
        SeedTestData(context);
        return context;
    }

    /// <summary>
    /// Seed dữ liệu mẫu cho test: 1 user, 1 category, 2 products, 3 vouchers.
    /// </summary>
    private static void SeedTestData(AppDbContext context)
    {
        // Seed User
        var testUser = new User
        {
            Id = TestConstants.TestUserId,
            Email = "test@dafl.vn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Test@123"),
            FullName = "Test User",
            PhoneNumber = "0901234567",
            Address = "123 Test Street",
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            // Nghiệp vụ v3: chỉ tài khoản đã xác thực email mới đăng nhập được → user seed của test phải verified
            EmailVerified = true,
            EmailVerifiedAt = DateTime.UtcNow
        };
        context.Users.Add(testUser);

        // Seed Category
        var category = new Category
        {
            Id = TestConstants.TestCategoryId,
            Name = "Điện thoại",
            Slug = "dien-thoai",
            Description = "Các loại điện thoại thông minh",
            CreatedAt = DateTime.UtcNow
        };
        context.Categories.Add(category);

        // Seed Products
        var product1 = new Product
        {
            Id = TestConstants.TestProductId1,
            CategoryId = category.Id,
            Name = "iPhone 15 Pro Max",
            Slug = "iphone-15-pro-max",
            Description = "Điện thoại Apple mới nhất",
            Price = 34990000m,
            OriginalPrice = 36990000m,
            Stock = 50,
            ReservedStock = 0,
            ImageUrl = "https://example.com/iphone15.jpg",
            Rating = 4.8,
            ReviewCount = 120,
            CreatedAt = DateTime.UtcNow
        };

        var product2 = new Product
        {
            Id = TestConstants.TestProductId2,
            CategoryId = category.Id,
            Name = "Samsung Galaxy S24 Ultra",
            Slug = "samsung-galaxy-s24-ultra",
            Description = "Flagship Samsung",
            Price = 31990000m,
            OriginalPrice = 33990000m,
            Stock = 30,
            ReservedStock = 0,
            ImageUrl = "https://example.com/s24ultra.jpg",
            Rating = 4.7,
            ReviewCount = 85,
            CreatedAt = DateTime.UtcNow
        };
        context.Products.AddRange(product1, product2);

        // Seed Vouchers
        var voucher1 = new Voucher
        {
            Id = Guid.NewGuid(),
            Code = "DAFL10",
            Description = "Giảm 10% đơn hàng đầu tiên",
            DiscountType = "Percentage",
            DiscountValue = 10m,
            MinOrderAmount = 100000m,
            MaxDiscountAmount = 500000m,
            IsActive = true
        };

        var voucher2 = new Voucher
        {
            Id = Guid.NewGuid(),
            Code = "FREESHIP",
            Description = "Miễn phí vận chuyển",
            DiscountType = "Fixed",
            DiscountValue = 30000m,
            MinOrderAmount = 200000m,
            IsActive = true
        };

        var voucherExpired = new Voucher
        {
            Id = Guid.NewGuid(),
            Code = "EXPIRED50",
            Description = "Giảm 50% (Đã hết hạn)",
            DiscountType = "Percentage",
            DiscountValue = 50m,
            MinOrderAmount = 0m,
            ExpiryDate = DateTime.UtcNow.AddDays(-1), // Đã hết hạn
            IsActive = true
        };

        var voucherForDev = new Voucher
        {
            Id = Guid.NewGuid(),
            Code = "FORDEV",
            Description = "Dev voucher - giảm còn 2000đ",
            DiscountType = "Fixed",
            DiscountValue = 0m,
            MinOrderAmount = 0m,
            IsActive = true
        };

        context.Vouchers.AddRange(voucher1, voucher2, voucherExpired, voucherForDev);
        context.SaveChanges();
    }
}

/// <summary>
/// Các hằng số dùng chung cho toàn bộ test suite.
/// Giúp đảm bảo tính nhất quán khi tham chiếu đến các entity test.
/// </summary>
public static class TestConstants
{
    public static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid TestCategoryId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid TestProductId1 = Guid.Parse("33333333-3333-3333-3333-333333333333");
    public static readonly Guid TestProductId2 = Guid.Parse("44444444-4444-4444-4444-444444444444");
}
