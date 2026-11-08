using DAFL.Backend.Common;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Membership;

// ---------- Hội viên — phía khách (§5, §6, §7.6, §8.1) ----------

public record MembershipDto(
    string Tier, string TierLabel, int AvailablePoints, int ExpiringSoonPoints,
    decimal TotalSpent12m, decimal NextTierSpent, string? NextTier, string? NextTierLabel,
    int SpendPerPoint, int MaxPointsPercent, decimal? FreeShipThreshold, bool AutoUsePoints,
    string? DefaultPaymentMethod, DateTime? BirthDate);

public record GetMembershipQuery(Guid UserId) : IRequest<ApiResponse<MembershipDto>>;

public class GetMembershipQueryHandler : IRequestHandler<GetMembershipQuery, ApiResponse<MembershipDto>>
{
    private readonly AppDbContext _db;
    public GetMembershipQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<MembershipDto>> Handle(GetMembershipQuery request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<MembershipDto>.Fail("Không tìm thấy tài khoản.");
        var configs = await MembershipService.GetConfigsAsync(_db, ct);
        var config = MembershipService.ConfigFor(configs, user.MembershipTier);
        var next = configs.Where(c => c.MinSpent > config.MinSpent).OrderBy(c => c.MinSpent).FirstOrDefault();
        var balance = await MembershipService.AvailablePointsAsync(_db, user.Id, ct);
        var expiring = await MembershipService.ExpiringSoonPointsAsync(_db, user.Id, ct);
        return ApiResponse<MembershipDto>.Ok(new MembershipDto(
            MembershipService.NormalizeTier(user.MembershipTier),
            MembershipService.TierLabels[MembershipService.NormalizeTier(user.MembershipTier)],
            balance, expiring, user.TotalSpent12m,
            next?.MinSpent ?? 0, next?.Tier, next == null ? null : MembershipService.TierLabels[next.Tier],
            config.SpendPerPoint, config.MaxPointsPercent, config.FreeShipThreshold,
            user.AutoUsePoints, user.DefaultPaymentMethod, user.BirthDate));
    }
}

public record PointLedgerDto(Guid Id, string Type, int Points, DateTime? ExpiresAt, string? Reason, Guid? OrderId, DateTime CreatedAt);

public record GetPointLedgerQuery(Guid UserId, int Page = 1, int PageSize = 20) : IRequest<ApiResponse<List<PointLedgerDto>>>;

public class GetPointLedgerQueryHandler : IRequestHandler<GetPointLedgerQuery, ApiResponse<List<PointLedgerDto>>>
{
    private readonly AppDbContext _db;
    public GetPointLedgerQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<PointLedgerDto>>> Handle(GetPointLedgerQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var rows = await _db.PointTransactions.AsNoTracking()
            .Where(p => p.UserId == request.UserId)
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new PointLedgerDto(p.Id, p.Type, p.Points, p.ExpiresAt, p.Reason, p.OrderId, p.CreatedAt))
            .ToListAsync(ct);
        return ApiResponse<List<PointLedgerDto>>.Ok(rows);
    }
}

public record MyVoucherDto(
    Guid Id, string Code, string Description, string DiscountType, decimal DiscountValue,
    decimal MinOrderAmount, decimal? MaxDiscountAmount, DateTime? ExpiryDate, string? MinTier, bool IsPersonal);

public record GetMyVouchersQuery(Guid UserId) : IRequest<ApiResponse<List<MyVoucherDto>>>;

public class GetMyVouchersQueryHandler : IRequestHandler<GetMyVouchersQuery, ApiResponse<List<MyVoucherDto>>>
{
    private readonly AppDbContext _db;
    public GetMyVouchersQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<MyVoucherDto>>> Handle(GetMyVouchersQuery request, CancellationToken ct)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<List<MyVoucherDto>>.Fail("Không tìm thấy tài khoản.");
        var now = DateTime.UtcNow;
        var vouchers = await _db.Vouchers.AsNoTracking()
            .Where(v => v.IsActive && v.Status == "Active"
                && (!v.ExpiryDate.HasValue || v.ExpiryDate.Value > now)
                && (v.OwnerUserId == null || v.OwnerUserId == request.UserId)
                && (v.MinTier == null || MembershipService.TierRank(user.MembershipTier) >= MembershipService.TierRank(v.MinTier)))
            .OrderBy(v => v.ExpiryDate)
            .Select(v => new MyVoucherDto(v.Id, v.Code, v.Description, v.DiscountType, v.DiscountValue,
                v.MinOrderAmount, v.MaxDiscountAmount, v.ExpiryDate, v.MinTier, v.OwnerUserId.HasValue))
            .ToListAsync(ct);
        return ApiResponse<List<MyVoucherDto>>.Ok(vouchers);
    }
}

/// <summary>Cập nhật tùy chọn hội viên (§6.1): ngày sinh, phương thức mặc định, tự dùng điểm.
/// Ngày sinh bị khóa sửa 90 ngày sau mỗi lần đổi (§7.6).</summary>
public record UpdateMembershipPreferencesCommand(
    Guid UserId, DateTime? BirthDate, string? DefaultPaymentMethod, bool? AutoUsePoints)
    : IRequest<ApiResponse<MembershipDto>>;

public class UpdateMembershipPreferencesCommandValidator : AbstractValidator<UpdateMembershipPreferencesCommand>
{
    public UpdateMembershipPreferencesCommandValidator()
    {
        RuleFor(x => x.BirthDate).Must(d => d == null || (d.Value.Date <= DateTime.UtcNow.Date.AddYears(-10) && d.Value.Date >= DateTime.UtcNow.Date.AddYears(-120)))
            .WithMessage("Ngày sinh không hợp lệ.");
        RuleFor(x => x.DefaultPaymentMethod).Must(m => m == null || m == "COD" || m == "PayOS")
            .WithMessage("Phương thức mặc định phải là COD hoặc PayOS.");
    }
}

public class UpdateMembershipPreferencesCommandHandler : IRequestHandler<UpdateMembershipPreferencesCommand, ApiResponse<MembershipDto>>
{
    private readonly AppDbContext _db;
    public UpdateMembershipPreferencesCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<MembershipDto>> Handle(UpdateMembershipPreferencesCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<MembershipDto>.Fail("Không tìm thấy tài khoản.");
        if (request.BirthDate.HasValue)
        {
            if (user.BirthDateChangedAt.HasValue && user.BirthDateChangedAt.Value.AddDays(90) > DateTime.UtcNow)
                return ApiResponse<MembershipDto>.Fail("Ngày sinh chỉ được sửa 1 lần trong 90 ngày để chống trục lợi voucher sinh nhật.");
            user.BirthDate = request.BirthDate.Value.Date;
            user.BirthDateChangedAt = DateTime.UtcNow;
        }
        if (request.DefaultPaymentMethod != null) user.DefaultPaymentMethod = request.DefaultPaymentMethod;
        if (request.AutoUsePoints.HasValue) user.AutoUsePoints = request.AutoUsePoints.Value;
        await _db.SaveChangesAsync(ct);
        return await new GetMembershipQueryHandler(_db).Handle(new GetMembershipQuery(user.Id), ct);
    }
}

/// <summary>
/// Voucher sinh nhật (§7.6): hạng Vàng trở lên, đã nhập ngày sinh, trong 30 ngày quanh ngày sinh,
/// mỗi năm 1 lần. Mã riêng, dùng 1 lần, hạn 30 ngày.
/// </summary>
public record ClaimBirthdayVoucherCommand(Guid UserId) : IRequest<ApiResponse<MyVoucherDto>>;

public class ClaimBirthdayVoucherCommandHandler : IRequestHandler<ClaimBirthdayVoucherCommand, ApiResponse<MyVoucherDto>>
{
    private readonly AppDbContext _db;
    public ClaimBirthdayVoucherCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<MyVoucherDto>> Handle(ClaimBirthdayVoucherCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<MyVoucherDto>.Fail("Không tìm thấy tài khoản.");
        if (MembershipService.TierRank(user.MembershipTier) < MembershipService.TierRank("Gold"))
            return ApiResponse<MyVoucherDto>.Fail("Voucher sinh nhật chỉ dành cho hạng Vàng trở lên.");
        if (!user.BirthDate.HasValue)
            return ApiResponse<MyVoucherDto>.Fail("Vui lòng cập nhật ngày sinh trong hồ sơ hội viên trước.");
        var now = DateTime.UtcNow;
        var thisYearBirthday = new DateTime(now.Year, user.BirthDate.Value.Month, user.BirthDate.Value.Day);
        if (Math.Abs((thisYearBirthday - now).TotalDays) > 30)
            return ApiResponse<MyVoucherDto>.Fail("Voucher sinh nhật chỉ nhận được trong 30 ngày quanh ngày sinh của bạn.");
        var existing = await _db.Vouchers.AnyAsync(v => v.OwnerUserId == user.Id
            && v.Description.StartsWith("Voucher sinh nhật") && v.CreatedAt.Year == now.Year, ct);
        if (existing) return ApiResponse<MyVoucherDto>.Fail("Bạn đã nhận voucher sinh nhật năm nay rồi.");

        var code = $"BDAY{Guid.NewGuid():N}"[..10].ToUpperInvariant();
        var voucher = new Voucher
        {
            Id = Guid.NewGuid(), Code = code, Description = "Voucher sinh nhật hạng " + MembershipService.TierLabels[MembershipService.NormalizeTier(user.MembershipTier)],
            DiscountType = "Percentage", DiscountValue = 15, MinOrderAmount = 0, MaxDiscountAmount = 150000,
            ExpiryDate = now.AddDays(30), IsActive = true, Status = "Active",
            MaxUses = 1, MaxUsesPerUser = 1, MinTier = user.MembershipTier,
            OwnerUserId = user.Id, CreatedAt = now
        };
        _db.Vouchers.Add(voucher);
        await _db.SaveChangesAsync(ct);
        return ApiResponse<MyVoucherDto>.Ok(new MyVoucherDto(voucher.Id, voucher.Code, voucher.Description,
            voucher.DiscountType, voucher.DiscountValue, voucher.MinOrderAmount, voucher.MaxDiscountAmount,
            voucher.ExpiryDate, voucher.MinTier, true), "Đã phát voucher sinh nhật (giảm 15%, tối đa 150.000đ, hạn 30 ngày).");
    }
}

/// <summary>Mua lại 1 chạm (§6.3/§8.1): cho sản phẩm còn Active + còn hàng vào giỏ theo số lượng cũ
/// (giảm xuống bằng tồn kho nếu ít hơn); ngừng bán/hết hàng liệt kê riêng. Giá tính theo giá hiện tại.</summary>
public record ReorderResultDto(List<ReorderItemDto> Added, List<ReorderItemDto> Skipped);

public record ReorderItemDto(Guid ProductId, string ProductName, int Quantity, string Reason);

public record ReorderCommand(Guid UserId, Guid OrderId) : IRequest<ApiResponse<ReorderResultDto>>;

public class ReorderCommandHandler : IRequestHandler<ReorderCommand, ApiResponse<ReorderResultDto>>
{
    private readonly AppDbContext _db;
    public ReorderCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<ReorderResultDto>> Handle(ReorderCommand request, CancellationToken ct)
    {
        var order = await _db.Orders.AsNoTracking().Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
        // Đơn của người khác → 404 chung, không lộ (§8.2).
        if (order == null || order.UserId != request.UserId)
            return ApiResponse<ReorderResultDto>.Fail("Không tìm thấy đơn hàng.");

        var cart = await _db.Carts.Include(c => c.Items).FirstOrDefaultAsync(c => c.UserId == request.UserId, ct);
        if (cart == null)
        {
            cart = new Infrastructure.Data.Cart { Id = Guid.NewGuid(), UserId = request.UserId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            _db.Carts.Add(cart);
        }

        var added = new List<ReorderItemDto>();
        var skipped = new List<ReorderItemDto>();
        foreach (var item in order.Items)
        {
            var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, ct);
            if (product == null || !product.IsActive || product.IsDeleted)
            {
                skipped.Add(new ReorderItemDto(item.ProductId, item.ProductName, 0, "Sản phẩm đã ngừng bán."));
                continue;
            }
            var available = product.Stock - product.ReservedStock;
            if (available <= 0)
            {
                skipped.Add(new ReorderItemDto(item.ProductId, item.ProductName, 0, "Sản phẩm đã hết hàng."));
                continue;
            }
            var qty = Math.Min(item.Quantity, available);
            var existing = cart.Items.FirstOrDefault(i => i.ProductId == product.Id);
            if (existing != null)
            {
                existing.Quantity = Math.Min(existing.Quantity + qty, available);
            }
            else
            {
                cart.Items.Add(new CartItem
                {
                    Id = Guid.NewGuid(), CartId = cart.Id, ProductId = product.Id,
                    Quantity = qty, UnitPrice = product.Price, AddedAt = DateTime.UtcNow
                });
            }
            added.Add(new ReorderItemDto(product.Id, product.Name, qty,
                qty < item.Quantity ? $"Chỉ còn {available} sản phẩm." : "Đã thêm vào giỏ."));
        }
        cart.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<ReorderResultDto>.Ok(new ReorderResultDto(added, skipped),
            added.Count == 0 ? "Không có sản phẩm nào còn mua được." : $"Đã cho {added.Count} sản phẩm vào giỏ.");
    }
}

/// <summary>
/// Job bảo trì hội viên (§5.2/§5.3): chạy hằng ngày — hết hạn điểm quá 12 tháng (ghi EXPIRED),
/// xét lại hạng (hạ tối đa 1 bậc/kỳ, không hạ ngay khi vừa lên hạng).
/// Chạy lần đầu sau 5 phút khởi động rồi lặp mỗi 24 giờ.
/// </summary>
public class MembershipMaintenanceWorker : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<MembershipMaintenanceWorker> _logger;
    public MembershipMaintenanceWorker(IServiceProvider services, ILogger<MembershipMaintenanceWorker> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = DateTime.UtcNow;

                // 1. Điểm hết hạn: lô dương còn điểm, quá 12 tháng → RemainingPoints = 0 + dòng EXPIRED.
                var expiredLots = await db.PointTransactions
                    .Where(p => p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0
                        && p.ExpiresAt.HasValue && p.ExpiresAt.Value <= now)
                    .ToListAsync(stoppingToken);
                foreach (var lot in expiredLots)
                {
                    var left = lot.RemainingPoints!.Value;
                    lot.RemainingPoints = 0;
                    db.PointTransactions.Add(new PointTransaction
                    {
                        Id = Guid.NewGuid(), UserId = lot.UserId, OrderId = lot.OrderId, Type = "EXPIRED",
                        Points = -left, RemainingPoints = null, ExpiresAt = null,
                        Reason = "Điểm hết hạn sau 12 tháng", CreatedAt = now
                    });
                }
                if (expiredLots.Count > 0)
                    _logger.LogInformation("MembershipMaintenance: expired {Count} point lots.", expiredLots.Count);

                // 2. Xét lại hạng: hạ tối đa 1 bậc nếu chi tiêu 12 tháng tụt dưới ngưỡng hạng hiện tại.
                var configs = await MembershipService.GetConfigsAsync(db, stoppingToken);
                var users = await db.Users.Where(u => u.Role == "Customer").ToListAsync(stoppingToken);
                foreach (var user in users)
                {
                    user.TotalSpent12m = await MembershipService.RecalculateSpent12mAsync(db, user.Id, stoppingToken);
                    var target = MembershipService.TierForSpent(configs, user.TotalSpent12m);
                    var currentRank = MembershipService.TierRank(user.MembershipTier);
                    var targetRank = MembershipService.TierRank(target);
                    if (targetRank < currentRank)
                    {
                        user.MembershipTier = MembershipService.TiersInOrder[currentRank - 1];
                        _logger.LogInformation("MembershipMaintenance: user {UserId} downgraded to {Tier}.", user.Id, user.MembershipTier);
                    }
                }
                await db.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MembershipMaintenance failed: {Message}", ex.Message);
            }
            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
        }
    }
}
