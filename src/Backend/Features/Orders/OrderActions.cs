using DAFL.Backend.Common;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders;

// ---------- Hành động của khách trên đơn (§8.1/§8.2/§9.2) ----------

/// <summary>Khách bấm "Đã nhận hàng" (Delivered → Completed): cộng điểm + xét hạng (§4).</summary>
public record ConfirmReceivedCommand(Guid UserId, Guid OrderId) : IRequest<ApiResponse<string>>;

public class ConfirmReceivedCommandHandler : IRequestHandler<ConfirmReceivedCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public ConfirmReceivedCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(ConfirmReceivedCommand request, CancellationToken ct)
    {
        var order = await _db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
        if (order == null || order.UserId != request.UserId)
            return ApiResponse<string>.Fail("Không tìm thấy đơn hàng.");
        if (order.Status != OrderStatus.Delivered)
            return ApiResponse<string>.Fail("Chỉ xác nhận đã nhận hàng khi đơn đang ở trạng thái Đã giao.");
        var now = DateTime.UtcNow;
        order.Status = OrderStatus.Completed;
        _db.OrderStatusHistories.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(), OrderId = order.Id, Status = OrderStatus.Completed,
            PreviousStatus = OrderStatus.Delivered, ChangedByUserId = request.UserId,
            Note = "Khách hàng xác nhận đã nhận hàng.", Timestamp = now
        });
        await OrderCompletion.ApplyCompletionAsync(_db, order, now, ct);
        await _db.SaveChangesAsync(ct);
        var msg = order.PointsEarned > 0
            ? $"Cảm ơn bạn! Đơn đã hoàn tất và bạn nhận được {order.PointsEarned} điểm."
            : "Cảm ơn bạn! Đơn đã hoàn tất.";
        return ApiResponse<string>.Ok(msg);
    }
}

// ---------- Trả hàng / hoàn tiền ghi nhận (§9.2) ----------

public record ReturnRequestDto(
    Guid Id, Guid OrderId, string? OrderDisplayCode, Guid ProductId, string ProductName,
    int Quantity, string Reason, string? Note, string Status, string? AdminNote,
    decimal RefundAmount, string? RefundStatus, DateTime CreatedAt);

public record CreateReturnRequestCommand(
    Guid UserId, Guid OrderId, Guid ProductId, int Quantity, string Reason, string? Note)
    : IRequest<ApiResponse<ReturnRequestDto>>;

public class CreateReturnRequestCommandValidator : AbstractValidator<CreateReturnRequestCommand>
{
    public CreateReturnRequestCommandValidator()
    {
        RuleFor(x => x.Quantity).GreaterThan(0).WithMessage("Số lượng trả phải lớn hơn 0.");
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500).WithMessage("Vui lòng chọn/nhập lý do trả hàng.");
        RuleFor(x => x.Note).MaximumLength(1000).WithMessage("Ghi chú tối đa 1000 ký tự.");
    }
}

public class CreateReturnRequestCommandHandler : IRequestHandler<CreateReturnRequestCommand, ApiResponse<ReturnRequestDto>>
{
    private readonly AppDbContext _db;
    public CreateReturnRequestCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<ReturnRequestDto>> Handle(CreateReturnRequestCommand request, CancellationToken ct)
    {
        var order = await _db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == request.OrderId, ct);
        if (order == null || order.UserId != request.UserId)
            return ApiResponse<ReturnRequestDto>.Fail("Không tìm thấy đơn hàng.");
        // Chỉ tạo yêu cầu trong 7 ngày từ Delivered (§9.2).
        if (order.Status != OrderStatus.Delivered || !order.DeliveredAt.HasValue
            || order.DeliveredAt.Value.AddDays(7) < DateTime.UtcNow)
            return ApiResponse<ReturnRequestDto>.Fail("Chỉ yêu cầu trả hàng trong 7 ngày kể từ khi đơn được giao.");
        var item = order.Items.FirstOrDefault(i => i.ProductId == request.ProductId);
        if (item == null)
            return ApiResponse<ReturnRequestDto>.Fail("Sản phẩm không thuộc đơn hàng này.");
        if (request.Quantity > item.Quantity)
            return ApiResponse<ReturnRequestDto>.Fail("Số lượng trả không được vượt số lượng đã mua.");
        var alreadyReturned = await _db.ReturnRequests
            .Where(r => r.OrderId == order.Id && r.ProductId == request.ProductId && r.Status != "Rejected")
            .SumAsync(r => (int?)r.Quantity, ct) ?? 0;
        if (alreadyReturned + request.Quantity > item.Quantity)
            return ApiResponse<ReturnRequestDto>.Fail("Sản phẩm này đã được yêu cầu trả trước đó.");

        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            var now = DateTime.UtcNow;
            var ret = new ReturnRequest
            {
                Id = Guid.NewGuid(), OrderId = order.Id, UserId = request.UserId,
                ProductId = item.ProductId, ProductName = item.ProductName,
                Quantity = request.Quantity, Reason = request.Reason.Trim(), Note = request.Note?.Trim(),
                Status = "Pending", CreatedAt = now
            };
            _db.ReturnRequests.Add(ret);
            order.Status = OrderStatus.ReturnRequested;
            _db.OrderStatusHistories.Add(new OrderStatusHistory
            {
                Id = Guid.NewGuid(), OrderId = order.Id, Status = OrderStatus.ReturnRequested,
                PreviousStatus = OrderStatus.Delivered, ChangedByUserId = request.UserId,
                Note = $"Khách yêu cầu trả hàng: {item.ProductName} × {request.Quantity}. Lý do: {request.Reason.Trim()}",
                Timestamp = now
            });
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return ApiResponse<ReturnRequestDto>.Ok(ToDto(ret, order.OrderDisplayCode, 0, null),
                "Đã gửi yêu cầu trả hàng. Quản trị viên sẽ xem xét và phản hồi.");
        });
    }

    public static ReturnRequestDto ToDto(ReturnRequest r, string? displayCode, decimal refundAmount, string? refundStatus) => new(
        r.Id, r.OrderId, displayCode, r.ProductId, r.ProductName, r.Quantity, r.Reason, r.Note,
        r.Status, r.AdminNote, refundAmount, refundStatus, r.CreatedAt);
}

public record ListReturnRequestsQuery(Guid? UserId, Guid? OrderId, string? Status, bool AdminView = false)
    : IRequest<ApiResponse<List<ReturnRequestDto>>>;

public class ListReturnRequestsQueryHandler : IRequestHandler<ListReturnRequestsQuery, ApiResponse<List<ReturnRequestDto>>>
{
    private readonly AppDbContext _db;
    public ListReturnRequestsQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<ReturnRequestDto>>> Handle(ListReturnRequestsQuery request, CancellationToken ct)
    {
        var query = _db.ReturnRequests.AsNoTracking().Include(r => r.Order).Include(r => r.Refunds).AsQueryable();
        if (!request.AdminView && request.UserId.HasValue) query = query.Where(r => r.UserId == request.UserId.Value);
        if (request.OrderId.HasValue) query = query.Where(r => r.OrderId == request.OrderId.Value);
        if (!string.IsNullOrWhiteSpace(request.Status)) query = query.Where(r => r.Status == request.Status.Trim());
        var list = await query.OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync(ct);
        return ApiResponse<List<ReturnRequestDto>>.Ok(list.Select(r =>
        {
            var refund = r.Refunds.OrderByDescending(x => x.CreatedAt).FirstOrDefault();
            return CreateReturnRequestCommandHandler.ToDto(r, r.Order?.OrderDisplayCode,
                refund?.Amount ?? 0, refund?.Status);
        }).ToList());
    }
}

/// <summary>
/// Admin duyệt trả hàng (§9.2): hoàn kho cho sản phẩm đủ điều kiện bán lại, trừ điểm đã cộng tương ứng,
/// hoàn điểm đã dùng, nhả lượt voucher nếu trả toàn bộ, tạo RefundRecord "Chờ hoàn tiền".
/// Từ chối: bắt buộc ghi lý do, đơn quay về Delivered.
/// </summary>
public record ResolveReturnRequestCommand(Guid ReturnId, Guid AdminId, bool Approve, string? AdminNote)
    : IRequest<ApiResponse<string>>;

public class ResolveReturnRequestCommandValidator : AbstractValidator<ResolveReturnRequestCommand>
{
    public ResolveReturnRequestCommandValidator()
    {
        RuleFor(x => x.AdminNote).NotEmpty().When(x => !x.Approve)
            .WithMessage("Từ chối yêu cầu trả hàng bắt buộc phải ghi lý do.");
        RuleFor(x => x.AdminNote).MaximumLength(500).WithMessage("Ghi chú tối đa 500 ký tự.");
    }
}

public class ResolveReturnRequestCommandHandler : IRequestHandler<ResolveReturnRequestCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public ResolveReturnRequestCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(ResolveReturnRequestCommand request, CancellationToken ct)
    {
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            try
            {
                var ret = await _db.ReturnRequests.Include(r => r.Order).ThenInclude(o => o!.Items)
                    .FirstOrDefaultAsync(r => r.Id == request.ReturnId, ct);
                if (ret == null || ret.Order == null)
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail("Không tìm thấy yêu cầu trả hàng.");
                }
                if (ret.Status != "Pending")
                {
                    await tx.RollbackAsync(ct);
                    return ApiResponse<string>.Fail("Yêu cầu trả hàng đã được xử lý trước đó.");
                }
                var order = ret.Order;
                var now = DateTime.UtcNow;

                if (!request.Approve)
                {
                    ret.Status = "Rejected";
                    ret.AdminNote = request.AdminNote!.Trim();
                    ret.ResolvedAt = now;
                    order.Status = OrderStatus.Delivered; // quay về trạng thái trước đó (§9.2)
                    _db.OrderStatusHistories.Add(new OrderStatusHistory
                    {
                        Id = Guid.NewGuid(), OrderId = order.Id, Status = OrderStatus.Delivered,
                        PreviousStatus = OrderStatus.ReturnRequested, ChangedByUserId = request.AdminId,
                        Note = $"Admin từ chối yêu cầu trả hàng ({ret.ProductName}). Lý do: {request.AdminNote.Trim()}",
                        Timestamp = now
                    });
                    await _db.SaveChangesAsync(ct);
                    await tx.CommitAsync(ct);
                    return ApiResponse<string>.Ok("Đã từ chối yêu cầu trả hàng. Đơn quay về trạng thái Đã giao.");
                }

                ret.Status = "Approved";
                ret.AdminNote = request.AdminNote?.Trim();
                ret.ResolvedAt = now;

                var item = order.Items.First(i => i.ProductId == ret.ProductId);
                var refundAmount = item.UnitPrice * ret.Quantity;
                // Trả toàn bộ = sau khi duyệt yêu cầu này, mọi dòng của đơn đều đã trả đủ số lượng.
                var approvedQty = await _db.ReturnRequests
                    .Where(r => r.OrderId == order.Id && r.Status == "Approved")
                    .GroupBy(r => r.ProductId)
                    .Select(g => new { ProductId = g.Key, Qty = g.Sum(r => r.Quantity) })
                    .ToDictionaryAsync(x => x.ProductId, x => x.Qty, ct);
                var isFullReturn = order.Items.All(i =>
                    (approvedQty.GetValueOrDefault(i.ProductId) + (i.ProductId == ret.ProductId ? ret.Quantity : 0)) >= i.Quantity);

                // Hoàn kho cho sản phẩm đạt điều kiện bán lại.
                var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == ret.ProductId, ct);
                if (product != null) product.Stock += ret.Quantity;

                // Trừ điểm đã cộng tương ứng với phần trả (tỉ lệ theo tiền hàng trả / tiền hàng đơn).
                if (order.PointsEarned > 0 && order.UserId.HasValue)
                {
                    var goodsTotal = order.SubTotal - order.DiscountAmount - order.PointsDiscount;
                    var revoke = goodsTotal > 0
                        ? (int)Math.Floor(order.PointsEarned * (refundAmount / goodsTotal))
                        : 0;
                    await MembershipService.RevokeEarnedPointsAsync(_db, order.UserId.Value, order.Id, revoke, ct);
                }
                // Hoàn điểm đã dùng + nhả lượt voucher nếu trả toàn bộ.
                if (isFullReturn && order.UserId.HasValue)
                {
                    await MembershipService.ReleaseOrderBenefitsAsync(_db, order, ct);
                }

                _db.RefundRecords.Add(new RefundRecord
                {
                    Id = Guid.NewGuid(), ReturnRequestId = ret.Id, OrderId = order.Id,
                    Amount = refundAmount, Status = "PendingRefund", CreatedAt = now
                });
                order.Status = OrderStatus.Delivered;
                _db.OrderStatusHistories.Add(new OrderStatusHistory
                {
                    Id = Guid.NewGuid(), OrderId = order.Id, Status = OrderStatus.Delivered,
                    PreviousStatus = OrderStatus.ReturnRequested, ChangedByUserId = request.AdminId,
                    Note = $"Admin duyệt trả hàng ({ret.ProductName} × {ret.Quantity}). Hoàn tiền {refundAmount:N0}đ — trạng thái: Chờ hoàn tiền.",
                    Timestamp = now
                });
                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return ApiResponse<string>.Ok($"Đã duyệt trả hàng. Số tiền hoàn {refundAmount:N0}đ đang ở trạng thái Chờ hoàn tiền (admin hoàn ngoài hệ thống rồi nhập mã giao dịch).");
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync(ct);
                return ApiResponse<string>.Fail("Không thể xử lý yêu cầu trả hàng: " + ex.Message);
            }
        });
    }
}

/// <summary>Admin ghi nhận đã hoàn tiền (§9.2): nhập mã giao dịch hoàn → RefundRecord sang "Đã hoàn tiền".</summary>
public record RecordRefundCommand(Guid RefundId, string TransactionCode) : IRequest<ApiResponse<string>>;

public class RecordRefundCommandValidator : AbstractValidator<RecordRefundCommand>
{
    public RecordRefundCommandValidator()
    {
        RuleFor(x => x.TransactionCode).NotEmpty().Length(3, 100).WithMessage("Mã giao dịch hoàn tiền phải có từ 3 đến 100 ký tự.");
    }
}

public class RecordRefundCommandHandler : IRequestHandler<RecordRefundCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public RecordRefundCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(RecordRefundCommand request, CancellationToken ct)
    {
        var refund = await _db.RefundRecords.FirstOrDefaultAsync(r => r.Id == request.RefundId, ct);
        if (refund == null) return ApiResponse<string>.Fail("Không tìm thấy bản ghi hoàn tiền.");
        if (refund.Status == "Refunded") return ApiResponse<string>.Fail("Khoản hoàn tiền này đã được ghi nhận trước đó.");
        refund.Status = "Refunded";
        refund.TransactionCode = request.TransactionCode.Trim();
        refund.RefundedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã ghi nhận hoàn tiền.");
    }
}

/// <summary>Hóa đơn (§8.1): dữ liệu snapshot của đơn lúc mua (giá/voucher/điểm lấy từ lúc mua, không lấy giá hiện tại).
/// Chưa xuất PDF — FE dùng dữ liệu này để hiển thị/in hóa đơn.</summary>
public record InvoiceDto(
    string? OrderDisplayCode, long OrderCode, DateTime CreatedAt, string CustomerName, string CustomerEmail,
    string CustomerPhone, string ShippingAddress, string PaymentMethod, string Status, string StatusLabel,
    List<OrderItemHistoryDto> Items, decimal SubTotal, decimal DiscountAmount, string? VoucherCode,
    int PointsUsed, decimal PointsDiscount, int PointsEarned, decimal ShippingFee, decimal TotalAmount);

public record GetInvoiceQuery(Guid UserId, Guid OrderId) : IRequest<ApiResponse<InvoiceDto?>>;

public class GetInvoiceQueryHandler : IRequestHandler<GetInvoiceQuery, ApiResponse<InvoiceDto?>>
{
    private readonly AppDbContext _db;
    public GetInvoiceQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<InvoiceDto?>> Handle(GetInvoiceQuery request, CancellationToken ct)
    {
        var order = await _db.Orders.AsNoTracking().Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == request.OrderId && o.UserId == request.UserId, ct);
        if (order == null) return ApiResponse<InvoiceDto?>.Ok(null, "Không tìm thấy đơn hàng.");
        return ApiResponse<InvoiceDto?>.Ok(new InvoiceDto(
            order.OrderDisplayCode, order.OrderCode, order.CreatedAt, order.CustomerName, order.CustomerEmail,
            order.CustomerPhone, order.ShippingAddress, order.PaymentMethod, order.Status.ToString(),
            OrderStatusLabels.For(order.Status, order.PaymentMethod),
            order.Items.Select(i => new OrderItemHistoryDto(i.Id, i.ProductId, i.ProductName, i.ProductImageUrl, i.UnitPrice, i.Quantity)).ToList(),
            order.SubTotal, order.DiscountAmount, order.VoucherCode, order.PointsUsed, order.PointsDiscount,
            order.PointsEarned, order.ShippingFee, order.TotalAmount));
    }
}
