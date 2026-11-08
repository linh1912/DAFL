using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders;

/// <summary>
/// Hoàn tất đơn (Delivered → Completed) dùng chung cho admin và khách bấm "Đã nhận hàng" (§4/§8.1):
/// cộng điểm + tính chi tiêu nâng hạng, chỉ cộng 1 lần / đơn.
/// </summary>
public static class OrderCompletion
{
    public static async Task ApplyCompletionAsync(AppDbContext db, Order order, DateTime now, CancellationToken ct)
    {
        if (order.CompletedAt != null) return;
        order.CompletedAt = now;
        if (!order.UserId.HasValue) return;
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == order.UserId.Value, ct);
        if (user == null) return;
        var configs = await MembershipService.GetConfigsAsync(db, ct);
        var config = MembershipService.ConfigFor(configs, user.MembershipTier);
        var goods = order.SubTotal - order.DiscountAmount - order.PointsDiscount;
        var earned = MembershipService.EarnPointsFor(goods, config);
        if (earned > 0)
        {
            MembershipService.EarnPoints(db, user.Id, order.Id, earned);
            order.PointsEarned = earned;
        }
        // Chi tiêu 12 tháng: đơn hiện tại chưa được SaveChanges nên truy vấn DB chưa thấy nó —
        // cộng tay phần tiền hàng của đơn này (không tính ship, không tính phần trả bằng điểm).
        user.TotalSpent12m = await MembershipService.RecalculateSpent12mAsync(db, user.Id, ct) + Math.Max(0, goods);
        var target = MembershipService.TierForSpent(configs, user.TotalSpent12m);
        string? upgraded = null;
        if (MembershipService.TierRank(target) > MembershipService.TierRank(user.MembershipTier))
        {
            user.MembershipTier = target;
            upgraded = target;
        }
        if (upgraded != null)
        {
            db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(), UserId = user.Id,
                Title = "Chúc mừng bạn đã lên hạng hội viên!",
                Message = $"Bạn vừa lên hạng {MembershipService.TierLabels[upgraded]}. Ưu đãi mới áp dụng từ đơn tiếp theo.",
                Type = "Promotion", CreatedAt = now
            });
            var welcomeCode = $"UP{upgraded.ToUpperInvariant()}{Guid.NewGuid():N}"[..12].ToUpperInvariant();
            db.Vouchers.Add(new Voucher
            {
                Id = Guid.NewGuid(), Code = welcomeCode,
                Description = $"Voucher chào mừng hạng {MembershipService.TierLabels[upgraded]}",
                DiscountType = "Percentage", DiscountValue = 10, MinOrderAmount = 0,
                MaxDiscountAmount = 100000, ExpiryDate = now.AddDays(14),
                IsActive = true, Status = "Active", MaxUses = 1, MaxUsesPerUser = 1,
                MinTier = upgraded, OwnerUserId = user.Id, CreatedAt = now
            });
        }
    }
}
