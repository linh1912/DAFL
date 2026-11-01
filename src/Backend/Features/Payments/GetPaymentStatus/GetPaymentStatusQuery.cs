using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Payments;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Payments.GetPaymentStatus;

public record OrderStatusDto(
    long OrderCode,
    string Status,
    decimal TotalAmount,
    string CustomerName,
    DateTime CreatedAt,
    DateTime ExpiresAt);

public record GetPaymentStatusQuery(long OrderCode) : IRequest<ApiResponse<OrderStatusDto>>;

public class GetPaymentStatusQueryHandler : IRequestHandler<GetPaymentStatusQuery, ApiResponse<OrderStatusDto>>
{
    private readonly AppDbContext _context;
    private readonly IPayOSService _payOSService;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;

    public GetPaymentStatusQueryHandler(
        AppDbContext context,
        IPayOSService payOSService,
        IHubContext<NotificationHub, INotificationClient> hubContext)
    {
        _context = context;
        _payOSService = payOSService;
        _hubContext = hubContext;
    }

    public async Task<ApiResponse<OrderStatusDto>> Handle(GetPaymentStatusQuery request, CancellationToken cancellationToken)
    {
        var order = await _context.Orders
            .FirstOrDefaultAsync(o => o.OrderCode == request.OrderCode, cancellationToken);

        if (order == null)
        {
            return ApiResponse<OrderStatusDto>.Fail($"Không tìm thấy đơn hàng #{request.OrderCode}");
        }

        // If still pending, query PayOS directly to handle cases where webhook was delayed or blocked
        if (order.Status == OrderStatus.Pending)
        {
            var payosStatus = await _payOSService.GetPaymentStatusFromPayOSAsync(request.OrderCode, cancellationToken);
            if (string.Equals(payosStatus, "PAID", StringComparison.OrdinalIgnoreCase))
            {
                var trackedOrder = await _context.Orders
                    .Include(o => o.Items)
                    .FirstOrDefaultAsync(o => o.OrderCode == request.OrderCode, cancellationToken);

                if (trackedOrder != null && trackedOrder.Status == OrderStatus.Pending)
                {
                    var strategy = _context.Database.CreateExecutionStrategy();
                    await strategy.ExecuteAsync(async () =>
                    {
                        await using var tx = await _context.Database.BeginTransactionAsync(cancellationToken);
                        trackedOrder.Status = OrderStatus.Paid;
                        trackedOrder.StockDeducted = true; // đã trừ kho thật → hủy đơn phải hoàn kho (CN-08.3)

                        foreach (var item in trackedOrder.Items)
                        {
                            var prod = await _context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, cancellationToken);
                            if (prod != null)
                            {
                                prod.Stock = Math.Max(0, prod.Stock - item.Quantity);
                                prod.ReservedStock = Math.Max(0, prod.ReservedStock - item.Quantity);
                            }
                        }

                        var notif = new Notification
                        {
                            Id = Guid.NewGuid(),
                            UserId = trackedOrder.UserId,
                            Title = $"Đơn hàng #{trackedOrder.OrderCode} đã thanh toán thành công!",
                            Message = $"Cảm ơn quý khách {trackedOrder.CustomerName}. Đơn hàng {trackedOrder.TotalAmount:N0}đ đã được thanh toán qua PayOS.",
                            Type = "Payment",
                            IsRead = false,
                            CreatedAt = DateTime.UtcNow
                        };
                        await _context.Notifications.AddAsync(notif, cancellationToken);

                        await _context.SaveChangesAsync(cancellationToken);
                        await tx.CommitAsync(cancellationToken);
                    });

                    await _hubContext.Clients.All.ReceiveOrderStatusUpdate(trackedOrder.OrderCode, "Paid", "Thanh toán thành công qua PayOS!");
                    order = trackedOrder;
                }
            }
        }

        var dto = new OrderStatusDto(
            order.OrderCode,
            order.Status.ToString(),
            order.TotalAmount,
            order.CustomerName,
            order.CreatedAt,
            order.ExpiresAt);

        return ApiResponse<OrderStatusDto>.Ok(dto);
    }
}
