using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Infrastructure.Data;

public enum OrderStatus
{
    Pending = 0,
    Paid = 1,
    Cancelled = 2,
    Expired = 3
}

// ==========================================
// 1. Auth Module Domain Entities
// ==========================================

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? Address { get; set; }
    public string? AvatarUrl { get; set; }
    public string Role { get; set; } = "Customer";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // --- Xác thực email & khóa mềm đăng nhập (Luồng 3/4 - bản chốt v3) ---
    public bool EmailVerified { get; set; } = false;
    public DateTime? EmailVerifiedAt { get; set; }
    public int FailedLoginCount { get; set; } = 0;
    public DateTime? FailedLoginWindowStart { get; set; }
    public DateTime? LockedUntil { get; set; }
    public int LockEscalations { get; set; } = 0;

    public List<UserSession> Sessions { get; set; } = new();
    public List<Notification> Notifications { get; set; } = new();
    public List<Order> Orders { get; set; } = new();
    public List<Evaluation> Evaluations { get; set; } = new();
}

public class UserSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string SessionId { get; set; } = string.Empty;
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string Email { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(7);
}

/// <summary>
/// Mã OTP dùng chung cho 3 mục đích: xác thực email (VerifyEmail),
/// đặt lại mật khẩu (ResetPassword) và đăng nhập bằng OTP (OtpLogin).
/// Mã chỉ lưu dạng băm (SHA-256), dùng 1 lần, sai 5 lần thì bị vô hiệu.
/// </summary>
public class OtpCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string CodeHash { get; set; } = string.Empty;
    public string Purpose { get; set; } = string.Empty; // VerifyEmail | ResetPassword | OtpLogin
    public DateTime ExpiresAt { get; set; }
    public int Attempts { get; set; } = 0;
    public bool Used { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class OtpPurposes
{
    public const string VerifyEmail = "VerifyEmail";
    public const string ResetPassword = "ResetPassword";
    public const string OtpLogin = "OtpLogin";
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
}

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long OrderCode { get; set; }
    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string ShippingAddress { get; set; } = string.Empty;
    public decimal SubTotal { get; set; }
    public decimal DiscountAmount { get; set; }
    public string? VoucherCode { get; set; }
    public decimal TotalAmount { get; set; }
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
// 3. EF Core DbContext Definition
// ==========================================

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // Auth Module DbSets
    public DbSet<User> Users => Set<User>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<OtpCode> OtpCodes => Set<OtpCode>();
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
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.HasKey(us => us.Id);
            entity.HasIndex(us => us.SessionId).IsUnique();
            entity.HasOne(us => us.User)
                  .WithMany(u => u.Sessions)
                  .HasForeignKey(us => us.UserId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<OtpCode>(entity =>
        {
            entity.HasKey(o => o.Id);
            entity.HasIndex(o => new { o.Email, o.Purpose });
            entity.Property(o => o.Email).HasMaxLength(150).IsRequired();
            entity.Property(o => o.Purpose).HasMaxLength(30).IsRequired();
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
        });

        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasKey(o => o.Id);
            entity.HasIndex(o => o.OrderCode).IsUnique();
            entity.HasIndex(o => o.Status);
            entity.HasIndex(o => o.UserId);
            entity.Property(o => o.SubTotal).HasPrecision(18, 2);
            entity.Property(o => o.DiscountAmount).HasPrecision(18, 2);
            entity.Property(o => o.TotalAmount).HasPrecision(18, 2);

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
