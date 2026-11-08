using DAFL.Backend.Common;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders.GetOrderDetail;

/// <summary>
/// Chi tiết một đơn hàng (CN-08.2). Chỉ chủ đơn mới xem được:
/// đơn không tồn tại HOẶC thuộc về người khác đều trả về Data = null (endpoint map sang 404,
/// không lộ thông tin đơn của người khác).
/// </summary>
public record GetOrderDetailQuery(Guid UserId, Guid OrderId) : IRequest<ApiResponse<OrderHistoryDto?>>;

public class GetOrderDetailQueryHandler : IRequestHandler<GetOrderDetailQuery, ApiResponse<OrderHistoryDto?>>
{
    private readonly AppDbContext _context;

    public GetOrderDetailQueryHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<OrderHistoryDto?>> Handle(GetOrderDetailQuery request, CancellationToken cancellationToken)
    {
        var order = await _context.Orders
            .AsNoTracking()
            .Include(o => o.Items)
            .Include(o => o.StatusHistories)
            .FirstOrDefaultAsync(o => o.Id == request.OrderId && o.UserId == request.UserId, cancellationToken);

        if (order == null)
        {
            return ApiResponse<OrderHistoryDto?>.Ok(null, "Không tìm thấy đơn hàng.");
        }

        var dto = new OrderHistoryDto(
            order.Id,
            order.OrderCode,
            order.CustomerName,
            order.CustomerEmail,
            order.CustomerPhone,
            order.ShippingAddress,
            order.SubTotal,
            order.DiscountAmount,
            order.VoucherCode,
            order.TotalAmount,
            order.Status.ToString(),
            order.CreatedAt,
            order.PayOSCheckoutUrl,
            order.Items.Select(i => new OrderItemHistoryDto(i.Id, i.ProductId, i.ProductName, i.ProductImageUrl, i.UnitPrice, i.Quantity)).ToList(),
            order.StatusHistories.OrderBy(h => h.Timestamp).Select(h => new OrderStatusHistoryDto(h.Status, h.Note, h.Timestamp)).ToList(),
            order.OrderDisplayCode,
            order.PaymentMethod,
            order.ShippingFee,
            OrderStatusLabels.For(order.Status, order.PaymentMethod),
            order.CancelReason,
            order.ShipProvinceCode,
            order.ShipProvinceName,
            order.ShipDistrictCode,
            order.ShipDistrictName,
            order.ShipWardCode,
            order.ShipWardName,
            order.ShipDetailAddress,
            order.ShipNote,
            order.AddressBookId,
            order.PointsUsed,
            order.PointsDiscount,
            order.PointsEarned,
            order.FreeShipVoucherCode,
            order.TrackingCode,
            order.Carrier,
            order.DeliveredAt,
            order.CompletedAt);

        return ApiResponse<OrderHistoryDto?>.Ok(dto);
    }
}
