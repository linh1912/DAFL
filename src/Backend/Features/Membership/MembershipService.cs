using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Membership;

/// <summary>
/// Logic hội viên dùng chung cho checkout, admin, job bảo trì (tài liệu §5).
/// Bảng hạng mặc định (§5.1): Thường 0đ — 1 điểm/20.000đ, dùng tối đa 10%;
/// Bạc 2.000.000đ — 1/15.000đ, tối đa 15%, freeship từ 199.000đ;
/// Vàng 5.000.000đ — 1/10.000đ, tối đa 20%, freeship từ 99.000đ;
/// Kim cương 15.000.000đ — 1/8.000đ, tối đa 30%, freeship mọi đơn.
/// 1 điểm = 1.000đ khi thanh toán. Điểm hết hạn sau 12 tháng.
/// </summary>
public static class MembershipService
{
    public const int PointsValueVnd = 1000;
    public static readonly string[] TiersInOrder = { "Member", "Silver", "Gold", "Diamond" };

    public static readonly Dictionary<string, string> TierLabels = new()
    {
        ["Member"] = "Thường",
        ["Silver"] = "Bạc",
        ["Gold"] = "Vàng",
        ["Diamond"] = "Kim cương"
    };

    public static string NormalizeTier(string? tier)
        => string.IsNullOrWhiteSpace(tier) ? "Member"
            : TiersInOrder.FirstOrDefault(t => t.Equals(tier.Trim(), StringComparison.OrdinalIgnoreCase)) ?? "Member";

    public static int TierRank(string? tier) => Array.IndexOf(TiersInOrder, NormalizeTier(tier));

    /// <summary>Cấu hình hạng mặc định khi DB chưa có dòng seed (§5.1).</summary>
    public static List<MembershipTierConfig> DefaultConfigs() => new()
    {
        new() { Tier = "Member", MinSpent = 0, SpendPerPoint = 20000, MaxPointsPercent = 10, FreeShipThreshold = null, SortOrder = 0 },
        new() { Tier = "Silver", MinSpent = 2000000, SpendPerPoint = 15000, MaxPointsPercent = 15, FreeShipThreshold = 199000, SortOrder = 1 },
        new() { Tier = "Gold", MinSpent = 5000000, SpendPerPoint = 10000, MaxPointsPercent = 20, FreeShipThreshold = 99000, SortOrder = 2 },
        new() { Tier = "Diamond", MinSpent = 15000000, SpendPerPoint = 8000, MaxPointsPercent = 30, FreeShipThreshold = 0, SortOrder = 3 }
    };

    public static async Task<List<MembershipTierConfig>> GetConfigsAsync(AppDbContext db, CancellationToken ct)
    {
        var configs = await db.MembershipTierConfigs.AsNoTracking().OrderBy(c => c.SortOrder).ToListAsync(ct);
        return configs.Count > 0 ? configs : DefaultConfigs();
    }

    public static MembershipTierConfig ConfigFor(List<MembershipTierConfig> configs, string? tier)
    {
        var t = NormalizeTier(tier);
        return configs.FirstOrDefault(c => c.Tier.Equals(t, StringComparison.OrdinalIgnoreCase))
            ?? DefaultConfigs().First(c => c.Tier == t);
    }

    /// <summary>Hạng tương ứng với chi tiêu 12 tháng (ngưỡng cao nhất mà chi tiêu chạm tới).</summary>
    public static string TierForSpent(List<MembershipTierConfig> configs, decimal spent12m)
    {
        var tier = "Member";
        foreach (var c in configs.OrderBy(c => c.MinSpent))
            if (spent12m >= c.MinSpent) tier = c.Tier;
        return tier;
    }

    /// <summary>Số dư điểm khả dụng = tổng RemainingPoints của các lô dương chưa hết hạn.
    /// Không bao giờ âm (kẹp về 0).</summary>
    public static async Task<int> AvailablePointsAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var sum = await db.PointTransactions
            .Where(p => p.UserId == userId && p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0
                && (p.ExpiresAt == null || p.ExpiresAt.Value > now))
            .SumAsync(p => (int?)(p.RemainingPoints ?? 0), ct);
        return Math.Max(0, sum ?? 0);
    }

    /// <summary>Trừ điểm theo FIFO: lô sắp hết hạn dùng trước (§5.2). Ghi 1 dòng USE (âm) + trừ RemainingPoints từng lô.</summary>
    public static async Task<bool> UsePointsAsync(AppDbContext db, Guid userId, Guid orderId, int points, string reason, CancellationToken ct)
    {
        if (points <= 0) return true;
        if (!await DeductFromLotsAsync(db, userId, points, ct)) return false;
        var now = DateTime.UtcNow;
        db.PointTransactions.Add(new PointTransaction
        {
            Id = Guid.NewGuid(), UserId = userId, OrderId = orderId, Type = "USE",
            Points = -points, RemainingPoints = null, ExpiresAt = null,
            Reason = reason, CreatedAt = now
        });
        return true;
    }

    /// <summary>Trừ số điểm khỏi các lô dương theo FIFO (không ghi dòng sổ cái — dùng khi dòng sổ cái do caller tự ghi, vd ADMIN_ADJUST).</summary>
    public static async Task<bool> DeductFromLotsAsync(AppDbContext db, Guid userId, int points, CancellationToken ct)
    {
        if (points <= 0) return true;
        var now = DateTime.UtcNow;
        var lots = await db.PointTransactions
            .Where(p => p.UserId == userId && p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0
                && (p.ExpiresAt == null || p.ExpiresAt.Value > now))
            .OrderBy(p => p.ExpiresAt ?? DateTime.MaxValue).ThenBy(p => p.CreatedAt)
            .ToListAsync(ct);

        var remaining = points;
        foreach (var lot in lots)
        {
            if (remaining <= 0) break;
            var take = Math.Min(lot.RemainingPoints!.Value, remaining);
            lot.RemainingPoints -= take;
            remaining -= take;
        }
        return remaining <= 0;
    }

    /// <summary>Hoàn điểm đã dùng (hủy/trả đơn): tạo lô REFUND mới, hạn 12 tháng từ lúc hoàn.
    /// Chỉ hoàn 1 lần / đơn — gọi kèm kiểm tra đã có REFUND cho đơn này chưa.</summary>
    public static void RefundPoints(AppDbContext db, Guid userId, Guid orderId, int points, string reason)
    {
        if (points <= 0) return;
        var now = DateTime.UtcNow;
        db.PointTransactions.Add(new PointTransaction
        {
            Id = Guid.NewGuid(), UserId = userId, OrderId = orderId, Type = "REFUND",
            Points = points, RemainingPoints = points, ExpiresAt = now.AddMonths(12),
            Reason = reason, CreatedAt = now
        });
    }

    /// <summary>Cộng điểm khi đơn Completed (§5.2): làm tròn xuống (tiền hàng sau giảm, chưa gồm ship) / mức tích theo hạng tại thời điểm hoàn tất.</summary>
    public static int EarnPointsFor(decimal goodsAfterDiscount, MembershipTierConfig config)
    {
        if (goodsAfterDiscount <= 0 || config.SpendPerPoint <= 0) return 0;
        return (int)Math.Floor(goodsAfterDiscount / config.SpendPerPoint);
    }

    public static void EarnPoints(AppDbContext db, Guid userId, Guid orderId, int points)
    {
        if (points <= 0) return;
        var now = DateTime.UtcNow;
        db.PointTransactions.Add(new PointTransaction
        {
            Id = Guid.NewGuid(), UserId = userId, OrderId = orderId, Type = "EARN",
            Points = points, RemainingPoints = points, ExpiresAt = now.AddMonths(12),
            Reason = "Tích điểm khi đơn hoàn tất", CreatedAt = now
        });
    }

    /// <summary>Trừ lại điểm đã cộng khi đơn bị trả toàn bộ sau khi đã Completed (REVOKE) — số dư không âm.</summary>
    public static async Task RevokeEarnedPointsAsync(AppDbContext db, Guid userId, Guid orderId, int pointsToRevoke, CancellationToken ct)
    {
        if (pointsToRevoke <= 0) return;
        var now = DateTime.UtcNow;
        var lots = await db.PointTransactions
            .Where(p => p.UserId == userId && p.OrderId == orderId && p.Type == "EARN"
                && p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0)
            .OrderBy(p => p.CreatedAt).ToListAsync(ct);
        var remaining = pointsToRevoke;
        foreach (var lot in lots)
        {
            if (remaining <= 0) break;
            var take = Math.Min(lot.RemainingPoints!.Value, remaining);
            lot.RemainingPoints -= take;
            remaining -= take;
        }
        var revoked = pointsToRevoke - remaining;
        if (revoked > 0)
        {
            db.PointTransactions.Add(new PointTransaction
            {
                Id = Guid.NewGuid(), UserId = userId, OrderId = orderId, Type = "REVOKE",
                Points = -revoked, RemainingPoints = null, ExpiresAt = null,
                Reason = "Trừ lại điểm đã cộng do trả hàng", CreatedAt = now
            });
        }
    }

    /// <summary>Tính lại TotalSpent12m từ các đơn Completed trong 12 tháng gần nhất (không tính ship, không tính phần trả bằng điểm).</summary>
    public static async Task<decimal> RecalculateSpent12mAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        var from = DateTime.UtcNow.AddMonths(-12);
        // Cộng ở client: SQLite không Sum được decimal phía server (Postgres thì được).
        var spent = (await db.Orders
            .Where(o => o.UserId == userId && o.Status == OrderStatus.Completed && o.CompletedAt.HasValue && o.CompletedAt.Value >= from)
            .Select(o => o.SubTotal - o.DiscountAmount - o.PointsDiscount).ToListAsync(ct)).Sum();
        return Math.Max(0, spent);
    }

    /// <summary>Nâng hạng ngay khi chạm ngưỡng cao hơn (§5.3). Trả về hạng mới (null nếu không đổi).
    /// Hạ hạng KHÔNG làm ở đây — chỉ job xét lại hằng ngày, tối đa 1 bậc/kỳ.</summary>
    public static async Task<string?> EvaluateTierUpgradeAsync(AppDbContext db, User user, CancellationToken ct)
    {
        var configs = await GetConfigsAsync(db, ct);
        user.TotalSpent12m = await RecalculateSpent12mAsync(db, user.Id, ct);
        var target = TierForSpent(configs, user.TotalSpent12m);
        if (TierRank(target) > TierRank(user.MembershipTier))
        {
            user.MembershipTier = target;
            return target;
        }
        return null;
    }

    /// <summary>Nhả quyền lợi của 1 đơn bị hủy/hết hạn/trả toàn bộ: nhả lượt voucher + hoàn điểm đã dùng.
    /// Idempotent: mỗi thứ chỉ nhả 1 lần (kiểm tra PromotionUsage / REFUND đã tồn tại cho đơn).</summary>
    public static async Task ReleaseOrderBenefitsAsync(AppDbContext db, Order order, CancellationToken ct)
    {
        if (order.UserId == null) return;
        var userId = order.UserId.Value;

        // 1. Nhả lượt voucher (cả voucher tiền hàng và freeship)
        var usages = await db.PromotionUsages.Where(u => u.OrderId == order.Id).ToListAsync(ct);
        foreach (var usage in usages)
        {
            var voucher = await db.Vouchers.FirstOrDefaultAsync(v => v.Id == usage.VoucherId, ct);
            if (voucher != null && voucher.UsedCount > 0) voucher.UsedCount--;
            db.PromotionUsages.Remove(usage);
        }

        // 2. Hoàn điểm đã dùng (chỉ 1 lần)
        if (order.PointsUsed > 0)
        {
            var alreadyRefunded = await db.PointTransactions
                .AnyAsync(p => p.OrderId == order.Id && p.Type == "REFUND", ct);
            if (!alreadyRefunded)
                RefundPoints(db, userId, order.Id, order.PointsUsed, "Hoàn điểm do đơn bị hủy/hết hạn");
        }
    }

    /// <summary>Điểm sắp hết hạn trong 30 ngày tới (để FE nhắc khách dùng trước).</summary>
    public static async Task<int> ExpiringSoonPointsAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var sum = await db.PointTransactions
            .Where(p => p.UserId == userId && p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0
                && p.ExpiresAt.HasValue && p.ExpiresAt.Value > now && p.ExpiresAt.Value <= now.AddDays(30))
            .SumAsync(p => (int?)(p.RemainingPoints ?? 0), ct);
        return Math.Max(0, sum ?? 0);
    }
}
