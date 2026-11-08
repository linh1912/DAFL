using DAFL.Backend.Common;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Features.Orders;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Admin;

// ---------- Quản trị đơn hàng (§4 + §8.3) ----------

public record AdminOrderListDto(
    Guid Id, string? OrderDisplayCode, long OrderCode, string CustomerName, string CustomerEmail,
    string CustomerPhone, string Status, string StatusLabel, string PaymentMethod,
    decimal TotalAmount, decimal SubTotal, decimal DiscountAmount, string? VoucherCode,
    int PointsUsed, DateTime CreatedAt);

public record ListAdminOrdersQuery(
    string? Status, DateTime? From, DateTime? To, string? PaymentMethod,
    string? Search, bool? HasVoucher, bool? HasPoints, int Page = 1, int PageSize = 20)
    : IRequest<ApiResponse<List<AdminOrderListDto>>>;

public class ListAdminOrdersQueryHandler : IRequestHandler<ListAdminOrdersQuery, ApiResponse<List<AdminOrderListDto>>>
{
    private readonly AppDbContext _db;
    public ListAdminOrdersQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<AdminOrderListDto>>> Handle(ListAdminOrdersQuery request, CancellationToken ct)
    {
        var query = _db.Orders.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Status) && Enum.TryParse<OrderStatus>(request.Status.Trim(), true, out var st))
            query = query.Where(o => o.Status == st);
        if (request.From.HasValue) query = query.Where(o => o.CreatedAt >= request.From.Value);
        if (request.To.HasValue) query = query.Where(o => o.CreatedAt <= request.To.Value);
        if (!string.IsNullOrWhiteSpace(request.PaymentMethod)) query = query.Where(o => o.PaymentMethod == request.PaymentMethod.Trim());
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var s = request.Search.Trim().ToLower();
            query = query.Where(o => (o.OrderDisplayCode != null && o.OrderDisplayCode.ToLower().Contains(s))
                || o.CustomerName.ToLower().Contains(s) || o.CustomerEmail.ToLower().Contains(s)
                || o.Items.Any(i => i.ProductName.ToLower().Contains(s)));
        }
        if (request.HasVoucher == true) query = query.Where(o => o.VoucherCode != null || o.FreeShipVoucherCode != null);
        if (request.HasPoints == true) query = query.Where(o => o.PointsUsed > 0);
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var orders = await query.OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return ApiResponse<List<AdminOrderListDto>>.Ok(orders.Select(o => new AdminOrderListDto(
            o.Id, o.OrderDisplayCode, o.OrderCode, o.CustomerName, o.CustomerEmail, o.CustomerPhone,
            o.Status.ToString(), OrderStatusLabels.For(o.Status, o.PaymentMethod), o.PaymentMethod,
            o.TotalAmount, o.SubTotal, o.DiscountAmount, o.VoucherCode, o.PointsUsed, o.CreatedAt)).ToList());
    }
}

public record AdminOrderDetailDto(OrderHistoryDto Order, string? InternalNote, Guid? UserId);

public record GetAdminOrderDetailQuery(Guid OrderId) : IRequest<ApiResponse<AdminOrderDetailDto?>>;

public class GetAdminOrderDetailQueryHandler : IRequestHandler<GetAdminOrderDetailQuery, ApiResponse<AdminOrderDetailDto?>>
{
    private readonly AppDbContext _db;
    public GetAdminOrderDetailQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminOrderDetailDto?>> Handle(GetAdminOrderDetailQuery request, CancellationToken ct)
    {
        var order = await _db.Orders.AsNoTracking().Include(o => o.Items).Include(o => o.StatusHistories)
            .FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
        if (order == null) return ApiResponse<AdminOrderDetailDto?>.Ok(null, "Không tìm thấy đơn hàng.");
        var dto = new OrderHistoryDto(
            order.Id, order.OrderCode, order.CustomerName, order.CustomerEmail, order.CustomerPhone,
            order.ShippingAddress, order.SubTotal, order.DiscountAmount, order.VoucherCode,
            order.TotalAmount, order.Status.ToString(), order.CreatedAt, order.PayOSCheckoutUrl,
            order.Items.Select(i => new OrderItemHistoryDto(i.Id, i.ProductId, i.ProductName, i.ProductImageUrl, i.UnitPrice, i.Quantity)).ToList(),
            order.StatusHistories.OrderBy(h => h.Timestamp).Select(h => new OrderStatusHistoryDto(h.Status, h.Note, h.Timestamp)).ToList(),
            order.OrderDisplayCode, order.PaymentMethod, order.ShippingFee,
            OrderStatusLabels.For(order.Status, order.PaymentMethod), order.CancelReason,
            order.ShipProvinceCode, order.ShipProvinceName, order.ShipDistrictCode, order.ShipDistrictName,
            order.ShipWardCode, order.ShipWardName, order.ShipDetailAddress, order.ShipNote, order.AddressBookId,
            order.PointsUsed, order.PointsDiscount, order.PointsEarned, order.FreeShipVoucherCode,
            order.TrackingCode, order.Carrier, order.DeliveredAt, order.CompletedAt);
        return ApiResponse<AdminOrderDetailDto?>.Ok(new AdminOrderDetailDto(dto, order.InternalNote, order.UserId));
    }
}

/// <summary>Đổi trạng thái đơn theo máy trạng thái §4. Mọi lần chuyển đều ghi OrderStatusHistory + AuditLog.</summary>
public record ChangeOrderStatusCommand(
    Guid OrderId, Guid AdminId, string ToStatus, string? Carrier, string? TrackingCode,
    string? Note, string? InternalNote) : IRequest<ApiResponse<string>>;

public class ChangeOrderStatusCommandValidator : AbstractValidator<ChangeOrderStatusCommand>
{
    public ChangeOrderStatusCommandValidator()
    {
        RuleFor(x => x.ToStatus).NotEmpty().WithMessage("Vui lòng chọn trạng thái mới.")
            .Must(s => Enum.TryParse<OrderStatus>(s, true, out _)).WithMessage("Trạng thái không hợp lệ.");
        RuleFor(x => x.Note).MaximumLength(500).WithMessage("Ghi chú tối đa 500 ký tự.");
        RuleFor(x => x.InternalNote).MaximumLength(500).WithMessage("Ghi chú nội bộ tối đa 500 ký tự.");
    }
}

public class ChangeOrderStatusCommandHandler : IRequestHandler<ChangeOrderStatusCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public ChangeOrderStatusCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(ChangeOrderStatusCommand request, CancellationToken ct)
    {
        var to = Enum.Parse<OrderStatus>(request.ToStatus, true);
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            try
            {
                var order = await _db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
                if (order == null)
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail("Không tìm thấy đơn hàng.");
                }

                if (!OrderStateMachine.CanTransition(order.Status, to))
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail($"Chuyển trạng thái không hợp lệ: không thể chuyển từ {OrderStatusLabels.For(order.Status, order.PaymentMethod)} sang {OrderStatusLabels.For(to, order.PaymentMethod)}.");
                }

                if (OrderStateMachine.ValidateShippingRequirements(to, request.Carrier, request.TrackingCode) is { } shipError)
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail(shipError);
                }

                var oldStatus = order.Status;
                var now = DateTime.UtcNow;
                order.Status = to;
                if (to == OrderStatus.Shipping)
                {
                    order.Carrier = request.Carrier!.Trim();
                    order.TrackingCode = request.TrackingCode!.Trim();
                }
                if (to == OrderStatus.Delivered)
                {
                    order.DeliveredAt = now;
                    // Đơn COD: tại bước Đã giao mới ghi nhận đã thanh toán (§4).
                    if (order.PaymentMethod == "COD")
                    {
                        _db.PaymentTransactions.Add(new PaymentTransaction
                        {
                            Id = Guid.NewGuid(), OrderId = order.Id, OrderCode = order.OrderCode,
                            Amount = order.TotalAmount, Status = "PAID_COD_DELIVERED", CreatedAt = now
                        });
                    }
                }
                if (!string.IsNullOrWhiteSpace(request.InternalNote)) order.InternalNote = request.InternalNote.Trim();

                _db.OrderStatusHistories.Add(new OrderStatusHistory
                {
                    Id = Guid.NewGuid(), OrderId = order.Id, Status = to, PreviousStatus = oldStatus,
                    ChangedByUserId = request.AdminId,
                    Note = string.IsNullOrWhiteSpace(request.Note)
                        ? $"Admin chuyển trạng thái: {OrderStatusLabels.For(oldStatus, order.PaymentMethod)} → {OrderStatusLabels.For(to, order.PaymentMethod)}"
                        : request.Note.Trim(),
                    Timestamp = now
                });

                // Đơn Completed: cộng điểm + tính chi tiêu nâng hạng (§5.2/§5.3). Chỉ cộng 1 lần.
                if (to == OrderStatus.Completed && order.CompletedAt == null)
                {
                    await OrderCompletion.ApplyCompletionAsync(_db, order, now, ct);
                }

                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return ApiResponse<string>.Ok($"Đã chuyển đơn sang trạng thái {OrderStatusLabels.For(to, order.PaymentMethod)}.");
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync(ct);
                return ApiResponse<string>.Fail("Không thể đổi trạng thái đơn hàng: " + ex.Message);
            }
        });
    }
}

/// <summary>Admin hủy đơn (§4): mọi trạng thái trước Shipping; bắt buộc có lý do; hoàn kho + hoàn điểm + nhả voucher đúng 1 lần.</summary>
public record AdminCancelOrderCommand(Guid OrderId, Guid AdminId, string Reason) : IRequest<ApiResponse<string>>;

public class AdminCancelOrderCommandValidator : AbstractValidator<AdminCancelOrderCommand>
{
    public AdminCancelOrderCommandValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().WithMessage("Vui lòng chọn/nhập lý do hủy đơn.")
            .MaximumLength(500).WithMessage("Lý do hủy tối đa 500 ký tự.");
    }
}

public class AdminCancelOrderCommandHandler : IRequestHandler<AdminCancelOrderCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public AdminCancelOrderCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(AdminCancelOrderCommand request, CancellationToken ct)
    {
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            try
            {
                var order = await _db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
                if (order == null)
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail("Không tìm thấy đơn hàng.");
                }
                if (!OrderStateMachine.AdminCanCancel(order))
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail("Đơn hàng ở trạng thái này không thể hủy nữa.");
                }

                // Hoàn kho: kho đã trừ thật (COD / PayOS đã Paid) thì cộng lại; PayOS đang giữ chỗ thì nhả giữ chỗ.
                foreach (var item in order.Items)
                {
                    var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, ct);
                    if (product == null) continue;
                    if (order.StockDeducted) product.Stock += item.Quantity;
                    else product.ReservedStock = Math.Max(0, product.ReservedStock - item.Quantity);
                }

                // Hoàn điểm đã dùng + nhả lượt voucher (idempotent, §11.2).
                await MembershipService.ReleaseOrderBenefitsAsync(_db, order, ct);
                // Đơn đã Paid: chuyển sang chờ hoàn tiền ghi nhận (§9.2) — không tự hoàn tiền qua PayOS.
                var wasPaid = order.Status == OrderStatus.Paid
                    || (order.PaymentMethod == "PayOS" && order.StockDeducted);
                var oldStatus = order.Status;
                order.Status = OrderStatus.Cancelled;
                order.CancelReason = request.Reason.Trim();
                order.CancelledAt = DateTime.UtcNow;
                _db.OrderStatusHistories.Add(new OrderStatusHistory
                {
                    Id = Guid.NewGuid(), OrderId = order.Id, Status = OrderStatus.Cancelled,
                    PreviousStatus = oldStatus, ChangedByUserId = request.AdminId,
                    Note = $"Admin hủy đơn. Lý do: {request.Reason.Trim()}" +
                        (wasPaid ? " Đơn đã thanh toán — chuyển sang chờ hoàn tiền ghi nhận (xem mục Trả hàng/Hoàn tiền)." : ""),
                    Timestamp = DateTime.UtcNow
                });

                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return ApiResponse<string>.Ok("Đã hủy đơn hàng và hoàn kho/điểm/voucher (nếu có).");
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync(ct);
                return ApiResponse<string>.Fail("Không thể hủy đơn hàng: " + ex.Message);
            }
        });
    }
}
