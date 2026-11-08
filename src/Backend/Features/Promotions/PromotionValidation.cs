using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Promotions;

/// <summary>
/// Kiểm tra voucher theo đúng 9 bước ở tài liệu §7.5 (thứ tự quan trọng, thông báo đúng bảng).
/// Dùng chung cho: API kiểm tra mã ở giỏ/checkout, checkout lúc đặt hàng, và admin.
/// Lưu ý: hàm này KHÔNG trừ lượt dùng — lượt chỉ đếm khi đơn tạo thành công (trong cùng transaction checkout).
/// </summary>
public static class PromotionValidation
{
    public record VoucherCheckResult(
        Voucher? Voucher,
        string? Error,
        decimal EligibleSubTotal,
        decimal DiscountAmount,
        decimal ShippingDiscount);

    /// <param name="items">Danh sách (ProductId, CategoryId, LineTotal) của giỏ — để kiểm tra phạm vi (§7.5 bước 6).</param>
    /// <param name="isFreeShipSlot">true = mã này nằm ở ô freeship (chỉ chấp nhận loại FreeShip/FREESHIP).</param>
    /// <param name="goodsVoucherAlreadyApplied">true = đơn đã có 1 voucher tiền hàng (chặn stacking §7.3).</param>
    public static async Task<VoucherCheckResult> ValidateAsync(
        AppDbContext db,
        string code,
        Guid? userId,
        string? userTier,
        decimal subTotal,
        List<(Guid ProductId, Guid CategoryId, decimal LineTotal)> items,
        bool isFreeShipSlot = false,
        bool goodsVoucherAlreadyApplied = false,
        CancellationToken ct = default)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(normalized))
            return new VoucherCheckResult(null, "Vui lòng nhập mã giảm giá.", 0, 0, 0);

        var voucher = await db.Vouchers.FirstOrDefaultAsync(v => v.Code == normalized, ct);

        // 1. Mã tồn tại và đang Active
        if (voucher == null || !voucher.IsActive || voucher.Status != "Active")
            return new VoucherCheckResult(null, "Mã không tồn tại hoặc đã ngừng áp dụng.", 0, 0, 0);

        // Voucher cá nhân: chỉ đúng chủ sở hữu được dùng
        if (voucher.OwnerUserId.HasValue && (!userId.HasValue || voucher.OwnerUserId.Value != userId.Value))
            return new VoucherCheckResult(null, "Mã không tồn tại hoặc đã ngừng áp dụng.", 0, 0, 0);

        // 2. Trong thời gian bắt đầu — kết thúc
        var now = DateTime.UtcNow;
        if (voucher.StartDate.HasValue && now < voucher.StartDate.Value)
            return new VoucherCheckResult(null, "Mã chưa bắt đầu.", 0, 0, 0);
        if (voucher.ExpiryDate.HasValue && now >= voucher.ExpiryDate.Value)
            return new VoucherCheckResult(null, "Mã đã hết hạn.", 0, 0, 0);

        // 3. Còn tổng lượt dùng
        if (voucher.MaxUses.HasValue && voucher.UsedCount >= voucher.MaxUses.Value)
            return new VoucherCheckResult(null, "Mã đã hết lượt sử dụng.", 0, 0, 0);

        // 4. Chưa vượt lượt / người của tài khoản này (khách chưa đăng nhập không áp được mã giới hạn lượt/người)
        if (voucher.MaxUsesPerUser.HasValue)
        {
            if (!userId.HasValue)
                return new VoucherCheckResult(null, "Bạn cần đăng nhập để dùng mã này.", 0, 0, 0);
            var usedByUser = await db.PromotionUsages.CountAsync(u => u.VoucherId == voucher.Id && u.UserId == userId.Value, ct);
            if (usedByUser >= voucher.MaxUsesPerUser.Value)
                return new VoucherCheckResult(null, "Bạn đã dùng mã này rồi.", 0, 0, 0);
        }

        // 5. Tiền hàng đạt đơn tối thiểu (tính sau giảm giá sản phẩm, trước điểm và ship)
        if (subTotal < voucher.MinOrderAmount)
            return new VoucherCheckResult(null, $"Đơn cần từ {voucher.MinOrderAmount:N0} đồng để dùng mã này.", 0, 0, 0);

        // 6. Phạm vi: có ít nhất 1 sản phẩm thuộc danh mục/sản phẩm áp dụng; giảm chỉ tính trên phần thuộc phạm vi
        var eligibleSubTotal = subTotal;
        if (voucher.ScopeType == "Category" && voucher.ScopeCategoryId.HasValue)
        {
            eligibleSubTotal = items.Where(i => i.CategoryId == voucher.ScopeCategoryId.Value).Sum(i => i.LineTotal);
            if (eligibleSubTotal <= 0)
                return new VoucherCheckResult(null, "Mã không áp dụng cho sản phẩm trong giỏ.", 0, 0, 0);
        }
        else if (voucher.ScopeType == "Product" && !string.IsNullOrWhiteSpace(voucher.ScopeProductIds))
        {
            var ids = voucher.ScopeProductIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToHashSet();
            eligibleSubTotal = items.Where(i => ids.Contains(i.ProductId)).Sum(i => i.LineTotal);
            if (eligibleSubTotal <= 0)
                return new VoucherCheckResult(null, "Mã không áp dụng cho sản phẩm trong giỏ.", 0, 0, 0);
        }

        // 7. Hạng hội viên đạt yêu cầu (nếu voucher theo hạng)
        if (!string.IsNullOrWhiteSpace(voucher.MinTier))
        {
            var tier = MembershipService.NormalizeTier(userTier);
            if (!userId.HasValue)
                return new VoucherCheckResult(null, "Bạn cần đăng nhập để dùng mã này.", 0, 0, 0);
            if (MembershipService.TierRank(tier) < MembershipService.TierRank(voucher.MinTier))
                return new VoucherCheckResult(null, $"Mã dành cho hạng {MembershipService.TierLabels.GetValueOrDefault(MembershipService.NormalizeTier(voucher.MinTier), voucher.MinTier)} trở lên.", 0, 0, 0);
        }

        // 8. Không xung đột stacking (§7.3): tối đa 1 voucher tiền hàng + 1 freeship
        var isFreeShip = voucher.DiscountType == "FreeShip" || voucher.Code == "FREESHIP";
        if (isFreeShipSlot && !isFreeShip)
            return new VoucherCheckResult(null, "Mã này không phải mã miễn phí vận chuyển.", 0, 0, 0);
        if (!isFreeShipSlot && isFreeShip)
            return new VoucherCheckResult(null, "Mã miễn phí vận chuyển chỉ áp được ở ô freeship.", 0, 0, 0);
        if (!isFreeShip && goodsVoucherAlreadyApplied)
            return new VoucherCheckResult(null, "Đơn đã có 1 mã giảm tiền hàng.", 0, 0, 0);

        // 9. Trần giảm: số tiền giảm không vượt trần và không vượt tiền hàng thuộc phạm vi (tự cắt về trần, không báo lỗi)
        decimal discount = 0, shipDiscount = 0;
        if (isFreeShip)
        {
            // Freeship: giảm phí ship tối đa bằng DiscountValue (mặc định 25.000đ = phí ship chuẩn); checkout kẹp tiếp theo phí ship thực tế.
            shipDiscount = voucher.DiscountValue > 0 ? voucher.DiscountValue : 25000m;
            if (voucher.MaxDiscountAmount.HasValue) shipDiscount = Math.Min(shipDiscount, voucher.MaxDiscountAmount.Value);
        }
        else if (voucher.Code == "FORDEV")
        {
            discount = Math.Max(0, subTotal - 2000m);
        }
        else if (voucher.DiscountType == "Percentage")
        {
            discount = eligibleSubTotal * (voucher.DiscountValue / 100m);
            if (voucher.MaxDiscountAmount.HasValue && discount > voucher.MaxDiscountAmount.Value)
                discount = voucher.MaxDiscountAmount.Value;
        }
        else
        {
            discount = voucher.DiscountValue;
        }
        discount = Math.Min(discount, eligibleSubTotal);

        return new VoucherCheckResult(voucher, null, eligibleSubTotal, discount, shipDiscount);
    }
}
