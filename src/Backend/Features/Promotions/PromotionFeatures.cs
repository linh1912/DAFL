using DAFL.Backend.Common;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Promotions;

// ---------- Khuyến mãi — phía khách (§7.4/§7.5/§7.6) ----------

public record ValidateVoucherResultDto(
    string Code, decimal SubTotal, decimal DiscountAmount, decimal ShippingDiscount,
    decimal FinalGoodsTotal, string Message);

/// <summary>
/// Kiểm tra mã ở giỏ/checkout (chỉ kiểm tra, KHÔNG trừ lượt — lượt chỉ đếm khi đơn tạo thành công).
/// Hỗ trợ 2 mã: mã tiền hàng + mã freeship (stacking §7.3). UserId lấy từ JWT ở Program.cs.
/// </summary>
public record ValidateVoucherCommand(
    Guid? UserId, string? GoodsVoucherCode, string? FreeShipVoucherCode,
    decimal SubTotal, List<ValidateVoucherItemDto> Items) : IRequest<ApiResponse<ValidateVoucherResultDto>>;

public record ValidateVoucherItemDto(Guid ProductId, Guid CategoryId, decimal LineTotal);

public class ValidateVoucherCommandValidator : AbstractValidator<ValidateVoucherCommand>
{
    public ValidateVoucherCommandValidator()
    {
        RuleFor(x => x.SubTotal).GreaterThanOrEqualTo(0).WithMessage("Tiền hàng không hợp lệ.");
        RuleFor(x => x.GoodsVoucherCode).MaximumLength(50).WithMessage("Mã giảm giá quá dài.");
        RuleFor(x => x.FreeShipVoucherCode).MaximumLength(50).WithMessage("Mã freeship quá dài.");
        RuleFor(x => x).Must(x => !string.IsNullOrWhiteSpace(x.GoodsVoucherCode) || !string.IsNullOrWhiteSpace(x.FreeShipVoucherCode))
            .WithMessage("Vui lòng nhập mã giảm giá.");
    }
}

public class ValidateVoucherCommandHandler : IRequestHandler<ValidateVoucherCommand, ApiResponse<ValidateVoucherResultDto>>
{
    private readonly AppDbContext _db;
    public ValidateVoucherCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<ValidateVoucherResultDto>> Handle(ValidateVoucherCommand request, CancellationToken ct)
    {
        string? tier = null;
        if (request.UserId.HasValue)
        {
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == request.UserId.Value, ct);
            tier = user?.MembershipTier;
            if (user != null && user.IsLocked)
                return ApiResponse<ValidateVoucherResultDto>.Fail("Tài khoản đã bị khóa.");
        }
        var items = request.Items.Select(i => (i.ProductId, i.CategoryId, i.LineTotal)).ToList();

        decimal discount = 0, shipDiscount = 0;
        string? appliedCode = null;
        if (!string.IsNullOrWhiteSpace(request.GoodsVoucherCode))
        {
            var check = await PromotionValidation.ValidateAsync(_db, request.GoodsVoucherCode, request.UserId,
                tier, request.SubTotal, items, isFreeShipSlot: false, ct: ct);
            if (check.Error != null) return ApiResponse<ValidateVoucherResultDto>.Fail(check.Error);
            discount = check.DiscountAmount;
            appliedCode = check.Voucher!.Code;
        }
        if (!string.IsNullOrWhiteSpace(request.FreeShipVoucherCode))
        {
            var check = await PromotionValidation.ValidateAsync(_db, request.FreeShipVoucherCode, request.UserId,
                tier, request.SubTotal, items, isFreeShipSlot: true,
                goodsVoucherAlreadyApplied: !string.IsNullOrWhiteSpace(request.GoodsVoucherCode), ct: ct);
            if (check.Error != null) return ApiResponse<ValidateVoucherResultDto>.Fail(check.Error);
            shipDiscount = check.ShippingDiscount;
            appliedCode ??= check.Voucher!.Code;
        }

        var finalGoods = Math.Max(0, request.SubTotal - discount);
        return ApiResponse<ValidateVoucherResultDto>.Ok(
            new ValidateVoucherResultDto(appliedCode ?? string.Empty, request.SubTotal, discount, shipDiscount,
                finalGoods, $"Áp dụng mã thành công! Bạn được giảm {discount:N0}đ tiền hàng và {shipDiscount:N0}đ phí ship."),
            "Áp dụng mã thành công.");
    }
}
