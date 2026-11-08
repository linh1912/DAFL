using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders;

public class ReservationCleanupWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ReservationCleanupWorker> _logger;

    public ReservationCleanupWorker(IServiceProvider serviceProvider, ILogger<ReservationCleanupWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ReservationCleanupWorker started: Scanning for expired 15-minute stock reservations.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var now = DateTime.UtcNow;
                // Chỉ đơn PayOS mới có giữ chỗ kho 15 phút. Đơn COD ở trạng thái Pending là
                // "Chờ xác nhận" (đã trừ kho thật) — tuyệt đối không được hết hạn ở đây.
                var expiredOrders = await context.Orders
                    .Include(o => o.Items)
                    .Where(o => o.Status == OrderStatus.Pending && o.PaymentMethod == "PayOS" && o.ExpiresAt <= now)
                    .ToListAsync(stoppingToken);

                if (expiredOrders.Any())
                {
                    _logger.LogInformation("Found {Count} expired orders to release stock reservation.", expiredOrders.Count);

                    foreach (var order in expiredOrders)
                    {
                        foreach (var item in order.Items)
                        {
                            var product = await context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, stoppingToken);
                            if (product != null)
                            {
                                product.ReservedStock = Math.Max(0, product.ReservedStock - item.Quantity);
                            }
                        }

                        // Đơn hết hạn giữ kho: nhả lượt voucher + hoàn điểm đã dùng (đúng 1 lần, §11.2).
                        await MembershipService.ReleaseOrderBenefitsAsync(context, order, stoppingToken);
                        order.Status = OrderStatus.Expired;
                        context.OrderStatusHistories.Add(new OrderStatusHistory
                        {
                            Id = Guid.NewGuid(),
                            OrderId = order.Id,
                            Status = OrderStatus.Expired,
                            PreviousStatus = OrderStatus.Pending,
                            Note = "Hết hạn giữ kho 15 phút (PayOS chưa thanh toán) — đã nhả kho, voucher và điểm.",
                            Timestamp = DateTime.UtcNow
                        });
                        _logger.LogInformation("Released reserved stock for Expired Order #{OrderCode}.", order.OrderCode);
                    }

                    await context.SaveChangesAsync(stoppingToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while cleaning up expired order reservations: {Message}", ex.Message);
            }

            // Run check every 60 seconds
            await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
        }
    }
}
