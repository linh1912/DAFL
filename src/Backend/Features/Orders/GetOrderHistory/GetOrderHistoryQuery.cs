using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders.GetOrderHistory;

public record OrderItemHistoryDto(Guid Id, Guid ProductId, string ProductName, string? ProductImageUrl, decimal UnitPrice, int Quantity);

public record OrderStatusHistoryDto(OrderStatus Status, string Note, DateTime Timestamp);

/// <summary>Nhãn trạng thái tiếng Việt theo vòng đời CN-08 (DTO trả kèm để FE hiển thị trực tiếp).</summary>
public static class OrderStatusLabels
{
    public static string For(OrderStatus status, string paymentMethod) => status switch
    {
        OrderStatus.Pending => paymentMethod == "PayOS" ? "Chờ thanh toán" : "Chờ xác nhận",
        OrderStatus.Paid => "Chờ xác nhận",
        OrderStatus.Confirmed => "Đã xác nhận",
        OrderStatus.Preparing => "Đang chuẩn bị",
        OrderStatus.Shipping => "Đang giao",
        OrderStatus.Delivered => "Đã giao",
        OrderStatus.Completed => "Hoàn tất",
        OrderStatus.ReturnRequested => "Yêu cầu trả hàng",
        OrderStatus.Cancelled => "Đã hủy",
        OrderStatus.Expired => "Hết hạn thanh toán",
        _ => status.ToString()
    };
}

public record OrderHistoryDto(
    Guid Id,
    long OrderCode,
    string CustomerName,
    string CustomerEmail,
    string CustomerPhone,
    string ShippingAddress,
    decimal SubTotal,
    decimal DiscountAmount,
    string? VoucherCode,
    decimal TotalAmount,
    string Status,
    DateTime CreatedAt,
    string? CheckoutUrl,
    List<OrderItemHistoryDto> Items,
    List<OrderStatusHistoryDto> StatusHistories,
    string? OrderDisplayCode = null,
    string PaymentMethod = "COD",
    decimal ShippingFee = 0,
    string StatusLabel = "",
    string? CancelReason = null,
    // Snapshot giao hàng cấu trúc (Mục 7B.4) — null với các đơn cũ đặt trước v4
    string? ShipProvinceCode = null,
    string? ShipProvinceName = null,
    string? ShipDistrictCode = null,
    string? ShipDistrictName = null,
    string? ShipWardCode = null,
    string? ShipWardName = null,
    string? ShipDetailAddress = null,
    string? ShipNote = null,
    Guid? AddressBookId = null,
    // Hội viên + vận đơn (tài liệu §5/§8): điểm đã dùng/đã nhận, mã vận đơn, mốc giao/hoàn tất
    int PointsUsed = 0,
    decimal PointsDiscount = 0,
    int PointsEarned = 0,
    string? FreeShipVoucherCode = null,
    string? TrackingCode = null,
    string? Carrier = null,
    DateTime? DeliveredAt = null,
    DateTime? CompletedAt = null
);

public record GetOrderHistoryQuery(
    Guid? UserId,
    string? Email,
    int? Page = null,
    int? PageSize = null,
    string? Status = null,
    // Lọc nâng cao (§8.1): tìm theo mã đơn/tên sản phẩm, khoảng ngày, khoảng tiền
    string? Search = null,
    DateTime? From = null,
    DateTime? To = null,
    decimal? MinTotal = null,
    decimal? MaxTotal = null) : IRequest<ApiResponse<List<OrderHistoryDto>>>;

public class GetOrderHistoryQueryHandler : IRequestHandler<GetOrderHistoryQuery, ApiResponse<List<OrderHistoryDto>>>
{
    private readonly AppDbContext _context;

    public GetOrderHistoryQueryHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<List<OrderHistoryDto>>> Handle(GetOrderHistoryQuery request, CancellationToken cancellationToken)
    {
        var query = _context.Orders
            .AsNoTracking()
            .Include(o => o.Items)
            .Include(o => o.StatusHistories)
            .AsQueryable();

        if (request.UserId.HasValue)
        {
            query = query.Where(o => o.UserId == request.UserId.Value);
        }
        else if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var email = request.Email.Trim().ToLowerInvariant();
            query = query.Where(o => o.CustomerEmail.ToLower() == email);
        }

        // Lọc theo trạng thái (CN-08.1): chấp nhận tên enum ("Paid") hoặc nhãn tiếng Việt ("Chờ xác nhận")
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            var statusFilter = request.Status.Trim();
            if (Enum.TryParse<OrderStatus>(statusFilter, ignoreCase: true, out var statusEnum))
            {
                query = query.Where(o => o.Status == statusEnum);
            }
            else if (statusFilter == "Chờ xác nhận")
            {
                query = query.Where(o => o.Status == OrderStatus.Paid
                    || (o.Status == OrderStatus.Pending && o.PaymentMethod == "COD"));
            }
            else if (statusFilter == "Chờ thanh toán")
            {
                query = query.Where(o => o.Status == OrderStatus.Pending && o.PaymentMethod == "PayOS");
            }
            else
            {
                var labelMatch = new[] { OrderStatus.Confirmed, OrderStatus.Preparing, OrderStatus.Shipping, OrderStatus.Delivered, OrderStatus.Completed, OrderStatus.ReturnRequested, OrderStatus.Cancelled, OrderStatus.Expired }
                    .FirstOrDefault(s => OrderStatusLabels.For(s, "COD") == statusFilter);
                query = query.Where(o => o.Status == labelMatch);
            }
        }

        // Lọc nâng cao (§8.1): tìm theo mã đơn/tên sản phẩm, khoảng ngày, khoảng tiền.
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var s = request.Search.Trim().ToLower();
            query = query.Where(o => (o.OrderDisplayCode != null && o.OrderDisplayCode.ToLower().Contains(s))
                || o.Items.Any(i => i.ProductName.ToLower().Contains(s)));
        }
        if (request.From.HasValue) query = query.Where(o => o.CreatedAt >= request.From.Value);
        if (request.To.HasValue) query = query.Where(o => o.CreatedAt <= request.To.Value);
        if (request.MinTotal.HasValue) query = query.Where(o => o.TotalAmount >= request.MinTotal.Value);
        if (request.MaxTotal.HasValue) query = query.Where(o => o.TotalAmount <= request.MaxTotal.Value);

        query = query.OrderByDescending(o => o.CreatedAt);

        // Phân trang (CN-08.1): có tham số thì phân trang thật; không có thì giữ hành vi cũ (tối đa 20 đơn mới nhất)
        if (request.Page.HasValue || request.PageSize.HasValue)
        {
            var page = Math.Max(1, request.Page ?? 1);
            var pageSize = Math.Clamp(request.PageSize ?? 10, 1, 100);
            query = query.Skip((page - 1) * pageSize).Take(pageSize);
        }
        else
        {
            query = query.Take(20);
        }

        var orders = await query
            .Select(o => new OrderHistoryDto(
                o.Id,
                o.OrderCode,
                o.CustomerName,
                o.CustomerEmail,
                o.CustomerPhone,
                o.ShippingAddress,
                o.SubTotal,
                o.DiscountAmount,
                o.VoucherCode,
                o.TotalAmount,
                o.Status.ToString(),
                o.CreatedAt,
                o.PayOSCheckoutUrl,
                o.Items.Select(i => new OrderItemHistoryDto(i.Id, i.ProductId, i.ProductName, i.ProductImageUrl, i.UnitPrice, i.Quantity)).ToList(),
                o.StatusHistories.OrderBy(h => h.Timestamp).Select(h => new OrderStatusHistoryDto(h.Status, h.Note, h.Timestamp)).ToList(),
                o.OrderDisplayCode,
                o.PaymentMethod,
                o.ShippingFee,
                OrderStatusLabels.For(o.Status, o.PaymentMethod),
                o.CancelReason,
                o.ShipProvinceCode,
                o.ShipProvinceName,
                o.ShipDistrictCode,
                o.ShipDistrictName,
                o.ShipWardCode,
                o.ShipWardName,
                o.ShipDetailAddress,
                o.ShipNote,
                o.AddressBookId,
                o.PointsUsed,
                o.PointsDiscount,
                o.PointsEarned,
                o.FreeShipVoucherCode,
                o.TrackingCode,
                o.Carrier,
                o.DeliveredAt,
                o.CompletedAt
            ))
            .ToListAsync(cancellationToken);

        return ApiResponse<List<OrderHistoryDto>>.Ok(orders);
    }
}
