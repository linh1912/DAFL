using DAFL.Backend.Features.Membership;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace DAFL.Backend.Infrastructure.Data;

/// <summary>
/// Đồng bộ schema mở rộng lên database ĐÃ TỒN TẠI từ bản cũ.
/// <see cref="DbInitializer"/> dùng EnsureCreatedAsync — với DB đã có, EnsureCreated không tạo
/// thêm bảng/cột mới nên các thực thể mới (PointTransaction, PromotionUsage, …) sẽ lỗi khi truy vấn.
/// File này tạo bảng thiếu (CREATE TABLE IF NOT EXISTS) và thêm cột thiếu (ADD COLUMN IF NOT EXISTS)
/// dựa trên metadata của EF Core nên tên bảng/cột luôn khớp model. Khóa ngoại/index của bảng mới
/// chỉ đầy đủ trên DB tạo mới; DB cũ vẫn chạy đúng nghiệp vụ (FK không bắt buộc ở tầng DB).
/// </summary>
public static class ExtendedSchemaSync
{
    private static readonly Type[] NewTables =
    {
        typeof(PointTransaction), typeof(PromotionUsage), typeof(MembershipTierConfig),
        typeof(AuditLog), typeof(ReturnRequest), typeof(RefundRecord), typeof(PasswordResetCode),
        typeof(NewsletterSubscription)
    };

    private static readonly (Type Entity, string Property)[] NewColumns =
    {
        (typeof(User), nameof(User.IsLocked)), (typeof(User), nameof(User.TokenVersion)),
        (typeof(User), nameof(User.LastLoginAt)), (typeof(User), nameof(User.MembershipTier)),
        (typeof(User), nameof(User.TotalSpent12m)), (typeof(User), nameof(User.BirthDate)),
        (typeof(User), nameof(User.BirthDateChangedAt)), (typeof(User), nameof(User.DefaultPaymentMethod)),
        (typeof(User), nameof(User.AutoUsePoints)),
        (typeof(Category), nameof(Category.IsActive)), (typeof(Category), nameof(Category.SortOrder)),
        (typeof(Category), nameof(Category.Slug)), (typeof(Category), nameof(Category.IconUrl)),
        (typeof(Product), nameof(Product.IsDeleted)), (typeof(Product), nameof(Product.ImagesJson)),
        (typeof(Product), nameof(Product.Slug)),
        (typeof(Voucher), nameof(Voucher.StartDate)), (typeof(Voucher), nameof(Voucher.MaxUsesPerUser)),
        (typeof(Voucher), nameof(Voucher.MinTier)), (typeof(Voucher), nameof(Voucher.ScopeType)),
        (typeof(Voucher), nameof(Voucher.ScopeCategoryId)), (typeof(Voucher), nameof(Voucher.ScopeProductIds)),
        (typeof(Voucher), nameof(Voucher.Status)), (typeof(Voucher), nameof(Voucher.DisabledReason)),
        (typeof(Voucher), nameof(Voucher.OwnerUserId)), (typeof(Voucher), nameof(Voucher.CreatedAt)),
        (typeof(Order), nameof(Order.PointsUsed)), (typeof(Order), nameof(Order.PointsDiscount)),
        (typeof(Order), nameof(Order.PointsEarned)), (typeof(Order), nameof(Order.FreeShipVoucherCode)),
        (typeof(Order), nameof(Order.TrackingCode)), (typeof(Order), nameof(Order.Carrier)),
        (typeof(Order), nameof(Order.InternalNote)), (typeof(Order), nameof(Order.DeliveredAt)),
        (typeof(Order), nameof(Order.CompletedAt)),
        (typeof(OrderStatusHistory), nameof(OrderStatusHistory.PreviousStatus)),
        (typeof(OrderStatusHistory), nameof(OrderStatusHistory.ChangedByUserId))
    };

    public static async Task EnsureExtendedSchemaAsync(AppDbContext context, ILogger logger)
    {
        var isPostgres = context.Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL";
        try
        {
            foreach (var entityType in NewTables)
            {
                var entity = context.Model.FindEntityType(entityType);
                if (entity == null) continue;
                var table = Quote(entity.GetTableName()!, isPostgres);
                var columns = entity.GetProperties()
                    .Select(p => $"{Quote(p.GetColumnName(), isPostgres)} {MapType(p, isPostgres)}" +
                        (p.IsPrimaryKey() ? " PRIMARY KEY" : "") +
                        (p.IsNullable ? "" : " NOT NULL") +
                        DefaultClause(p, isPostgres))
                    .ToList();
                var sql = $"CREATE TABLE IF NOT EXISTS {table} ({string.Join(", ", columns)});";
                await context.Database.ExecuteSqlRawAsync(sql);
            }

            foreach (var (entityClrType, propertyName) in NewColumns)
            {
                var entity = context.Model.FindEntityType(entityClrType);
                if (entity == null) continue;
                var prop = entity.FindProperty(propertyName);
                if (prop == null) continue;
                var table = entity.GetTableName()!;
                var column = prop.GetColumnName();
                if (!isPostgres && await SqliteColumnExistsAsync(context, table, column)) continue;
                var ifNotExists = isPostgres ? "IF NOT EXISTS " : string.Empty;
                var sql = $"ALTER TABLE {Quote(table, isPostgres)} ADD COLUMN {ifNotExists}{Quote(column, isPostgres)} {MapType(prop, isPostgres)}" +
                    (prop.IsNullable ? "" : " NOT NULL") + DefaultClause(prop, isPostgres) + ";";
                await context.Database.ExecuteSqlRawAsync(sql);
            }

            // Seed cấu hình hạng hội viên mặc định (§5.1) nếu chưa có.
            if (!await context.MembershipTierConfigs.AnyAsync())
            {
                await context.MembershipTierConfigs.AddRangeAsync(MembershipService.DefaultConfigs());
                await context.SaveChangesAsync();
                logger.LogInformation("Seeded default membership tier configs.");
            }
        }
        catch (Exception ex)
        {
            // Không chặn khởi động: DB tạo mới qua EnsureCreated đã đủ schema; DB cũ thiếu bảng sẽ lỗi
            // khi gọi đúng endpoint đó — log rõ để admin biết cần tạo lại DB hoặc chạy DDL tay.
            logger.LogWarning(ex, "Extended schema sync failed (new tables/columns may be missing on an existing database): {Message}", ex.Message);
        }
    }

    private static async Task<bool> SqliteColumnExistsAsync(AppDbContext context, string table, string column)
    {
        await using var cmd = context.Database.GetDbConnection().CreateCommand();
        cmd.CommandText = $"PRAGMA table_info(\"{table.Replace("\"", "\"\"")}\")";
        if (cmd.Connection!.State != System.Data.ConnectionState.Open) await cmd.Connection.OpenAsync();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string Quote(string name, bool postgres) => postgres ? $"\"{name}\"" : $"\"{name}\"";

    private static string MapType(IProperty p, bool postgres)
    {
        var clr = Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType;
        if (clr.IsEnum) return postgres ? "integer" : "INTEGER";
        if (clr == typeof(Guid)) return postgres ? "uuid" : "TEXT";
        if (clr == typeof(string))
        {
            var max = p.GetMaxLength();
            return postgres ? (max.HasValue ? $"varchar({max.Value})" : "text") : "TEXT";
        }
        if (clr == typeof(int) || clr == typeof(int?)) return postgres ? "integer" : "INTEGER";
        if (clr == typeof(long)) return postgres ? "bigint" : "INTEGER";
        if (clr == typeof(decimal)) return postgres ? "numeric(18,2)" : "TEXT";
        if (clr == typeof(bool)) return postgres ? "boolean" : "INTEGER";
        if (clr == typeof(DateTime)) return postgres ? "timestamp with time zone" : "TEXT";
        if (clr == typeof(double)) return postgres ? "double precision" : "REAL";
        return "text";
    }

    private static string DefaultClause(IProperty p, bool postgres)
    {
        if (p.IsNullable) return string.Empty;
        var clr = Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType;
        if (clr == typeof(bool)) return postgres ? " DEFAULT false" : " DEFAULT 0";
        if (clr == typeof(int) || clr == typeof(long)) return " DEFAULT 0";
        if (clr == typeof(decimal)) return " DEFAULT 0";
        if (clr == typeof(string))
        {
            if (p.Name == nameof(Voucher.ScopeType)) return " DEFAULT 'All'";
            if (p.Name == nameof(Voucher.Status)) return " DEFAULT 'Active'";
            if (p.Name == nameof(User.MembershipTier)) return " DEFAULT 'Member'";
            return " DEFAULT ''";
        }
        if (clr == typeof(DateTime)) return postgres ? " DEFAULT NOW()" : " DEFAULT CURRENT_TIMESTAMP";
        return string.Empty;
    }
}
