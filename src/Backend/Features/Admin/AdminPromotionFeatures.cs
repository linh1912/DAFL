using DAFL.Backend.Common;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Admin;

// ---------- Khuyến mãi — quản trị (§7.2) ----------

public record AdminPromotionDto(
    Guid Id, string Code, string Description, string DiscountType, decimal DiscountValue,
    decimal MinOrderAmount, decimal? MaxDiscountAmount, DateTime? StartDate, DateTime? ExpiryDate,
    int? MaxUses, int UsedCount, int? MaxUsesPerUser, string? MinTier, string ScopeType,
    string Status, bool IsActive, string? DisabledReason, Guid? OwnerUserId, DateTime CreatedAt);

public record CreatePromotionCommand(
    string Code, string Description, string DiscountType, decimal DiscountValue,
    decimal MinOrderAmount, decimal? MaxDiscountAmount, DateTime? StartDate, DateTime? ExpiryDate,
    int? MaxUses, int? MaxUsesPerUser, string? MinTier, string ScopeType, Guid? ScopeCategoryId,
    string? ScopeProductIds) : IRequest<ApiResponse<AdminPromotionDto>>;

public class CreatePromotionCommandValidator : AbstractValidator<CreatePromotionCommand>
{
    public CreatePromotionCommandValidator()
    {
        RuleFor(x => x.Code).NotEmpty().WithMessage("Mã khuyến mãi không được để trống.")
            .Matches("^[A-Za-z0-9_-]{3,50}$").WithMessage("Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, từ 3 đến 50 ký tự.");
        RuleFor(x => x.Description).MaximumLength(500).WithMessage("Mô tả tối đa 500 ký tự.");
        RuleFor(x => x.DiscountType).Must(t => t is "Percentage" or "Fixed" or "FreeShip")
            .WithMessage("Loại khuyến mãi phải là Percentage, Fixed hoặc FreeShip.");
        RuleFor(x => x.DiscountValue).GreaterThan(0).WithMessage("Giá trị giảm phải lớn hơn 0.")
            .LessThanOrEqualTo(100).When(x => x.DiscountType == "Percentage")
            .WithMessage("Giảm theo % phải từ 1 đến 100.");
        RuleFor(x => x.MinOrderAmount).GreaterThanOrEqualTo(0).WithMessage("Đơn tối thiểu không được âm.");
        RuleFor(x => x.MaxDiscountAmount).GreaterThanOrEqualTo(0).When(x => x.MaxDiscountAmount.HasValue)
            .WithMessage("Trần giảm không được âm.");
        RuleFor(x => x.ExpiryDate).GreaterThan(x => x.StartDate).When(x => x.ExpiryDate.HasValue && x.StartDate.HasValue)
            .WithMessage("Ngày kết thúc phải sau ngày bắt đầu.");
        RuleFor(x => x.ExpiryDate).GreaterThan(DateTime.UtcNow).When(x => x.ExpiryDate.HasValue && !x.StartDate.HasValue)
            .WithMessage("Ngày kết thúc phải ở tương lai.");
        RuleFor(x => x.MaxUses).GreaterThan(0).When(x => x.MaxUses.HasValue).WithMessage("Tổng lượt phải lớn hơn 0.");
        RuleFor(x => x.MaxUsesPerUser).GreaterThan(0).When(x => x.MaxUsesPerUser.HasValue).WithMessage("Lượt/người phải lớn hơn 0.");
        RuleFor(x => x.MinTier).Must(t => t == null || MembershipService.TiersInOrder.Contains(t))
            .WithMessage("Hạng tối thiểu không hợp lệ (Member/Silver/Gold/Diamond).");
        RuleFor(x => x.ScopeType).Must(t => t is "All" or "Category" or "Product")
            .WithMessage("Phạm vi phải là All, Category hoặc Product.");
        RuleFor(x => x.ScopeCategoryId).NotEmpty().When(x => x.ScopeType == "Category")
            .WithMessage("Voucher theo danh mục phải chọn danh mục.");
        RuleFor(x => x.ScopeProductIds).NotEmpty().When(x => x.ScopeType == "Product")
            .WithMessage("Voucher theo sản phẩm phải chọn ít nhất 1 sản phẩm.");
    }
}

public class CreatePromotionCommandHandler : IRequestHandler<CreatePromotionCommand, ApiResponse<AdminPromotionDto>>
{
    private readonly AppDbContext _db;
    public CreatePromotionCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminPromotionDto>> Handle(CreatePromotionCommand request, CancellationToken ct)
    {
        var code = request.Code.Trim().ToUpperInvariant();
        if (await _db.Vouchers.AnyAsync(v => v.Code == code, ct))
            return ApiResponse<AdminPromotionDto>.Fail("Mã khuyến mãi đã tồn tại (không phân biệt hoa thường).");
        if (request.ScopeType == "Category" && request.ScopeCategoryId.HasValue
            && !await _db.Categories.AnyAsync(c => c.Id == request.ScopeCategoryId.Value, ct))
            return ApiResponse<AdminPromotionDto>.Fail("Danh mục áp dụng không tồn tại.");

        // Admin tạo ở trạng thái Draft (§7.2): chưa chạy cho tới khi bấm Kích hoạt.
        var voucher = new Voucher
        {
            Id = Guid.NewGuid(), Code = code, Description = request.Description?.Trim() ?? string.Empty,
            DiscountType = request.DiscountType, DiscountValue = request.DiscountValue,
            MinOrderAmount = request.MinOrderAmount, MaxDiscountAmount = request.MaxDiscountAmount,
            StartDate = request.StartDate, ExpiryDate = request.ExpiryDate,
            MaxUses = request.MaxUses, UsedCount = 0,
            MaxUsesPerUser = request.MaxUsesPerUser ?? 1,
            MinTier = string.IsNullOrWhiteSpace(request.MinTier) ? null : request.MinTier,
            ScopeType = request.ScopeType, ScopeCategoryId = request.ScopeCategoryId,
            ScopeProductIds = request.ScopeProductIds,
            Status = "Draft", IsActive = false, CreatedAt = DateTime.UtcNow
        };
        _db.Vouchers.Add(voucher);
        await _db.SaveChangesAsync(ct);
        return ApiResponse<AdminPromotionDto>.Ok(ToDto(voucher), "Đã tạo khuyến mãi ở trạng thái Nháp. Bấm Kích hoạt để chạy.");
    }

    public static AdminPromotionDto ToDto(Voucher v) => new(
        v.Id, v.Code, v.Description, v.DiscountType, v.DiscountValue, v.MinOrderAmount,
        v.MaxDiscountAmount, v.StartDate, v.ExpiryDate, v.MaxUses, v.UsedCount, v.MaxUsesPerUser,
        v.MinTier, v.ScopeType, v.Status, v.IsActive, v.DisabledReason, v.OwnerUserId, v.CreatedAt);
}

public record ListPromotionsQuery(string? Status, int Page = 1, int PageSize = 20)
    : IRequest<ApiResponse<List<AdminPromotionDto>>>;

public class ListPromotionsQueryHandler : IRequestHandler<ListPromotionsQuery, ApiResponse<List<AdminPromotionDto>>>
{
    private readonly AppDbContext _db;
    public ListPromotionsQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<AdminPromotionDto>>> Handle(ListPromotionsQuery request, CancellationToken ct)
    {
        var query = _db.Vouchers.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Status)) query = query.Where(v => v.Status == request.Status.Trim());
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var list = await query.OrderByDescending(v => v.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return ApiResponse<List<AdminPromotionDto>>.Ok(list.Select(CreatePromotionCommandHandler.ToDto).ToList());
    }
}

/// <summary>Kích hoạt (Draft → Active). Chỉ sửa được khi còn Draft (§7.2).</summary>
public record ActivatePromotionCommand(Guid Id) : IRequest<ApiResponse<string>>;

public class ActivatePromotionCommandHandler : IRequestHandler<ActivatePromotionCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public ActivatePromotionCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(ActivatePromotionCommand request, CancellationToken ct)
    {
        var voucher = await _db.Vouchers.FirstOrDefaultAsync(v => v.Id == request.Id, ct);
        if (voucher == null) return ApiResponse<string>.Fail("Không tìm thấy khuyến mãi.");
        if (voucher.Status == "Active") return ApiResponse<string>.Fail("Khuyến mãi đang chạy.");
        if (voucher.Status == "Expired") return ApiResponse<string>.Fail("Khuyến mãi đã hết hạn, không kích hoạt lại được.");
        if (voucher.ExpiryDate.HasValue && voucher.ExpiryDate.Value <= DateTime.UtcNow)
            return ApiResponse<string>.Fail("Khuyến mãi đã quá ngày kết thúc.");
        voucher.Status = "Active";
        voucher.IsActive = true;
        voucher.DisabledReason = null;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã kích hoạt khuyến mãi.");
    }
}

/// <summary>Tắt khẩn cấp (→ Disabled, ghi lý do). Đơn đã áp thành công trước đó vẫn giữ nguyên giảm giá (§7.2).</summary>
public record DisablePromotionCommand(Guid Id, string Reason) : IRequest<ApiResponse<string>>;

public class DisablePromotionCommandValidator : AbstractValidator<DisablePromotionCommand>
{
    public DisablePromotionCommandValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500).WithMessage("Vui lòng nhập lý do tắt khuyến mãi.");
    }
}

public class DisablePromotionCommandHandler : IRequestHandler<DisablePromotionCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public DisablePromotionCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(DisablePromotionCommand request, CancellationToken ct)
    {
        var voucher = await _db.Vouchers.FirstOrDefaultAsync(v => v.Id == request.Id, ct);
        if (voucher == null) return ApiResponse<string>.Fail("Không tìm thấy khuyến mãi.");
        voucher.Status = "Disabled";
        voucher.IsActive = false;
        voucher.DisabledReason = request.Reason.Trim();
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã tắt khuyến mãi khẩn cấp.");
    }
}

/// <summary>
/// Sửa khuyến mãi: Draft sửa toàn bộ; đã Active chỉ được tăng tổng lượt và kéo dài ngày kết thúc (§7.2).
/// Các trường khác gửi lên ở trạng thái Active sẽ bị bỏ qua (trả kèm ghi chú trong message).
/// </summary>
public record UpdatePromotionCommand(
    Guid Id, int? MaxUses, DateTime? ExpiryDate,
    string? Description, decimal? MinOrderAmount, decimal? MaxDiscountAmount)
    : IRequest<ApiResponse<AdminPromotionDto>>;

public class UpdatePromotionCommandValidator : AbstractValidator<UpdatePromotionCommand>
{
    public UpdatePromotionCommandValidator()
    {
        RuleFor(x => x.MaxUses).GreaterThan(0).When(x => x.MaxUses.HasValue).WithMessage("Tổng lượt phải lớn hơn 0.");
        RuleFor(x => x.MinOrderAmount).GreaterThanOrEqualTo(0).When(x => x.MinOrderAmount.HasValue).WithMessage("Đơn tối thiểu không được âm.");
        RuleFor(x => x.MaxDiscountAmount).GreaterThanOrEqualTo(0).When(x => x.MaxDiscountAmount.HasValue).WithMessage("Trần giảm không được âm.");
    }
}

public class UpdatePromotionCommandHandler : IRequestHandler<UpdatePromotionCommand, ApiResponse<AdminPromotionDto>>
{
    private readonly AppDbContext _db;
    public UpdatePromotionCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminPromotionDto>> Handle(UpdatePromotionCommand request, CancellationToken ct)
    {
        var voucher = await _db.Vouchers.FirstOrDefaultAsync(v => v.Id == request.Id, ct);
        if (voucher == null) return ApiResponse<AdminPromotionDto>.Fail("Không tìm thấy khuyến mãi.");
        if (voucher.Status == "Expired") return ApiResponse<AdminPromotionDto>.Fail("Khuyến mãi đã hết hạn, không sửa được.");

        var note = string.Empty;
        if (voucher.Status == "Draft")
        {
            if (request.Description != null) voucher.Description = request.Description;
            if (request.MinOrderAmount.HasValue) voucher.MinOrderAmount = request.MinOrderAmount.Value;
            if (request.MaxDiscountAmount.HasValue) voucher.MaxDiscountAmount = request.MaxDiscountAmount.Value;
            if (request.ExpiryDate.HasValue) voucher.ExpiryDate = request.ExpiryDate;
            if (request.MaxUses.HasValue) voucher.MaxUses = request.MaxUses;
        }
        else
        {
            // Active: chỉ tăng tổng lượt + kéo dài ngày kết thúc; giảm lượt hoặc rút ngắn ngày → từ chối.
            if (request.MaxUses.HasValue)
            {
                if (voucher.MaxUses.HasValue && request.MaxUses.Value < voucher.MaxUses.Value)
                    return ApiResponse<AdminPromotionDto>.Fail("Khuyến mãi đang chạy chỉ được tăng tổng lượt, không được giảm.");
                voucher.MaxUses = request.MaxUses;
            }
            if (request.ExpiryDate.HasValue)
            {
                if (voucher.ExpiryDate.HasValue && request.ExpiryDate.Value < voucher.ExpiryDate.Value)
                    return ApiResponse<AdminPromotionDto>.Fail("Khuyến mãi đang chạy chỉ được kéo dài ngày kết thúc, không được rút ngắn.");
                voucher.ExpiryDate = request.ExpiryDate;
            }
            note = " (Khuyến mãi đang chạy: chỉ áp dụng thay đổi tổng lượt / ngày kết thúc.)";
        }
        await _db.SaveChangesAsync(ct);
        return ApiResponse<AdminPromotionDto>.Ok(CreatePromotionCommandHandler.ToDto(voucher), "Đã cập nhật khuyến mãi." + note);
    }
}

public record PromotionUsageDto(Guid Id, Guid UserId, string UserEmail, Guid OrderId, string? OrderDisplayCode, decimal DiscountAmount, DateTime CreatedAt);

public record ListPromotionUsageQuery(Guid VoucherId, int Page = 1, int PageSize = 20)
    : IRequest<ApiResponse<List<PromotionUsageDto>>>;

public class ListPromotionUsageQueryHandler : IRequestHandler<ListPromotionUsageQuery, ApiResponse<List<PromotionUsageDto>>>
{
    private readonly AppDbContext _db;
    public ListPromotionUsageQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<PromotionUsageDto>>> Handle(ListPromotionUsageQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var usages = await _db.PromotionUsages.AsNoTracking()
            .Include(u => u.User).Include(u => u.Order)
            .Where(u => u.VoucherId == request.VoucherId)
            .OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new PromotionUsageDto(u.Id, u.UserId, u.User != null ? u.User.Email : string.Empty,
                u.OrderId, u.Order != null ? u.Order.OrderDisplayCode : null, u.DiscountAmount, u.CreatedAt))
            .ToListAsync(ct);
        return ApiResponse<List<PromotionUsageDto>>.Ok(usages);
    }
}

// ---------- Hội viên — quản trị (§3/§5) ----------

public record MembershipConfigDto(string Tier, decimal MinSpent, int SpendPerPoint, int MaxPointsPercent, decimal? FreeShipThreshold);

public record GetMembershipConfigQuery : IRequest<ApiResponse<List<MembershipConfigDto>>>;

public class GetMembershipConfigQueryHandler : IRequestHandler<GetMembershipConfigQuery, ApiResponse<List<MembershipConfigDto>>>
{
    private readonly AppDbContext _db;
    public GetMembershipConfigQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<MembershipConfigDto>>> Handle(GetMembershipConfigQuery request, CancellationToken ct)
    {
        var configs = await MembershipService.GetConfigsAsync(_db, ct);
        return ApiResponse<List<MembershipConfigDto>>.Ok(configs
            .Select(c => new MembershipConfigDto(c.Tier, c.MinSpent, c.SpendPerPoint, c.MaxPointsPercent, c.FreeShipThreshold)).ToList());
    }
}

public record UpdateMembershipConfigCommand(List<MembershipConfigDto> Tiers) : IRequest<ApiResponse<List<MembershipConfigDto>>>;

public class UpdateMembershipConfigCommandValidator : AbstractValidator<UpdateMembershipConfigCommand>
{
    public UpdateMembershipConfigCommandValidator()
    {
        RuleFor(x => x.Tiers).NotEmpty().WithMessage("Cần cấu hình ít nhất 1 hạng.")
            .Must(t => t.Any(c => c.Tier == "Member")).WithMessage("Phải có hạng Member (mốc 0đ).");
        RuleForEach(x => x.Tiers).ChildRules(t =>
        {
            t.RuleFor(c => c.Tier).Must(v => MembershipService.TiersInOrder.Contains(v)).WithMessage("Hạng không hợp lệ.");
            t.RuleFor(c => c.MinSpent).GreaterThanOrEqualTo(0).WithMessage("Ngưỡng chi tiêu không được âm.");
            t.RuleFor(c => c.SpendPerPoint).GreaterThan(0).WithMessage("Mức tích điểm phải lớn hơn 0.");
            t.RuleFor(c => c.MaxPointsPercent).InclusiveBetween(0, 100).WithMessage("Trần dùng điểm phải từ 0 đến 100%.");
            t.RuleFor(c => c.FreeShipThreshold).GreaterThanOrEqualTo(0).When(c => c.FreeShipThreshold.HasValue).WithMessage("Ngưỡng freeship không được âm.");
        });
        RuleFor(x => x.Tiers).Must(tiers =>
            {
                var ordered = tiers.OrderBy(t => t.MinSpent).Select(t => t.Tier).ToList();
                var expected = MembershipService.TiersInOrder.Where(t => tiers.Any(x => x.Tier == t)).ToList();
                return ordered.SequenceEqual(expected);
            }).WithMessage("Ngưỡng chi tiêu phải tăng dần theo thứ tự Member → Silver → Gold → Diamond.");
    }
}

public class UpdateMembershipConfigCommandHandler : IRequestHandler<UpdateMembershipConfigCommand, ApiResponse<List<MembershipConfigDto>>>
{
    private readonly AppDbContext _db;
    public UpdateMembershipConfigCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<MembershipConfigDto>>> Handle(UpdateMembershipConfigCommand request, CancellationToken ct)
    {
        foreach (var dto in request.Tiers)
        {
            var existing = await _db.MembershipTierConfigs.FirstOrDefaultAsync(c => c.Tier == dto.Tier, ct);
            if (existing == null)
            {
                _db.MembershipTierConfigs.Add(new MembershipTierConfig
                {
                    Id = Guid.NewGuid(), Tier = dto.Tier, MinSpent = dto.MinSpent,
                    SpendPerPoint = dto.SpendPerPoint, MaxPointsPercent = dto.MaxPointsPercent,
                    FreeShipThreshold = dto.FreeShipThreshold,
                    SortOrder = Array.IndexOf(MembershipService.TiersInOrder, dto.Tier)
                });
            }
            else
            {
                existing.MinSpent = dto.MinSpent;
                existing.SpendPerPoint = dto.SpendPerPoint;
                existing.MaxPointsPercent = dto.MaxPointsPercent;
                existing.FreeShipThreshold = dto.FreeShipThreshold;
            }
        }
        await _db.SaveChangesAsync(ct);
        // Thay đổi chỉ áp dụng cho đơn phát sinh sau thời điểm sửa — không tính lại đơn cũ (§5.1).
        var configs = await MembershipService.GetConfigsAsync(_db, ct);
        return ApiResponse<List<MembershipConfigDto>>.Ok(configs
            .Select(c => new MembershipConfigDto(c.Tier, c.MinSpent, c.SpendPerPoint, c.MaxPointsPercent, c.FreeShipThreshold)).ToList(),
            "Đã cập nhật cấu hình hạng hội viên. Thay đổi áp dụng cho đơn phát sinh sau thời điểm này.");
    }
}

/// <summary>Điều chỉnh điểm thủ công (§5.3): tối đa 1.000 điểm/lần, bắt buộc có lý do, luôn có AuditLog.</summary>
public record AdjustPointsCommand(Guid UserId, int Points, string Reason) : IRequest<ApiResponse<string>>;

public class AdjustPointsCommandValidator : AbstractValidator<AdjustPointsCommand>
{
    public AdjustPointsCommandValidator()
    {
        RuleFor(x => x.Points).NotEqual(0).WithMessage("Số điểm điều chỉnh không được bằng 0.")
            .Must(p => Math.Abs(p) <= 1000).WithMessage("Số điểm chỉnh 1 lần không quá 1.000 điểm.");
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500).WithMessage("Điều chỉnh điểm bắt buộc phải có lý do.");
    }
}

public class AdjustPointsCommandHandler : IRequestHandler<AdjustPointsCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public AdjustPointsCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(AdjustPointsCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<string>.Fail("Không tìm thấy tài khoản.");
        if (user.Role != "Customer") return ApiResponse<string>.Fail("Chỉ điều chỉnh điểm cho tài khoản khách hàng.");
        if (request.Points < 0)
        {
            var balance = await MembershipService.AvailablePointsAsync(_db, user.Id, ct);
            if (balance + request.Points < 0)
                return ApiResponse<string>.Fail($"Không thể trừ {Math.Abs(request.Points)} điểm — số dư khả dụng chỉ còn {balance} điểm.");
            // Trừ FIFO khỏi các lô còn lại rồi ghi 1 dòng ADMIN_ADJUST âm duy nhất.
            var ok = await MembershipService.DeductFromLotsAsync(_db, user.Id, Math.Abs(request.Points), ct);
            if (!ok) return ApiResponse<string>.Fail("Không đủ điểm khả dụng để trừ.");
            _db.PointTransactions.Add(new PointTransaction
            {
                Id = Guid.NewGuid(), UserId = user.Id, OrderId = null, Type = "ADMIN_ADJUST",
                Points = request.Points, RemainingPoints = null, ExpiresAt = null,
                Reason = "Admin trừ điểm: " + request.Reason, CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            var now = DateTime.UtcNow;
            _db.PointTransactions.Add(new PointTransaction
            {
                Id = Guid.NewGuid(), UserId = user.Id, OrderId = null, Type = "ADMIN_ADJUST",
                Points = request.Points, RemainingPoints = request.Points, ExpiresAt = now.AddMonths(12),
                Reason = "Admin cộng điểm: " + request.Reason, CreatedAt = now
            });
        }
        await _db.SaveChangesAsync(ct);
        var newBalance = await MembershipService.AvailablePointsAsync(_db, user.Id, ct);
        return ApiResponse<string>.Ok($"Đã điều chỉnh điểm. Số dư hiện tại: {newBalance} điểm.");
    }
}
