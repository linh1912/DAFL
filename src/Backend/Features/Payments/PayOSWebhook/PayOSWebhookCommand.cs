using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Infrastructure.Payments;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Payments.PayOSWebhook;

public record PayOSWebhookCommand(PayOSWebhookPayload Payload) : IRequest<ApiResponse<string>>;

public class PayOSWebhookCommandHandler : IRequestHandler<PayOSWebhookCommand, ApiResponse<string>>
{
    private readonly AppDbContext _context;
    private readonly IPayOSService _payOSService;
    private readonly IKafkaProducer _kafkaProducer;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;
    private readonly ILogger<PayOSWebhookCommandHandler> _logger;

    public PayOSWebhookCommandHandler(
        AppDbContext context,
        IPayOSService payOSService,
        IKafkaProducer kafkaProducer,
        IHubContext<NotificationHub, INotificationClient> hubContext,
        ILogger<PayOSWebhookCommandHandler> logger)
    {
        _context = context;
        _payOSService = payOSService;
        _kafkaProducer = kafkaProducer;
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task<ApiResponse<string>> Handle(PayOSWebhookCommand request, CancellationToken cancellationToken)
    {
        var payload = request.Payload;

        // 1. Verify Checksum HMAC-SHA256 signature
        if (!_payOSService.VerifyWebhookSignature(payload))
        {
            _logger.LogWarning("PayOS Webhook rejected: Invalid HMAC signature for Order #{OrderCode}", payload.Data?.OrderCode);
            return ApiResponse<string>.Fail("Chữ ký HMAC không hợp lệ.");
        }

        var orderCode = payload.Data.OrderCode;
        var order = await _context.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.OrderCode == orderCode, cancellationToken);

        if (order == null)
        {
            _logger.LogWarning("PayOS Webhook received for non-existent Order #{OrderCode}", orderCode);
            return ApiResponse<string>.Fail($"Không tìm thấy đơn hàng #{orderCode}");
        }

        // 2. Enforce Idempotency: if order is already Paid, return success immediately
        if (order.Status == OrderStatus.Paid)
        {
            _logger.LogInformation("Idempotent Webhook hit: Order #{OrderCode} is already in Paid status.", orderCode);
            return ApiResponse<string>.Ok("Đơn hàng đã được thanh toán trước đó (Idempotent OK).");
        }

        // 3. Begin transaction with execution strategy to commit order and finalize inventory deduction
        var strategy = _context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                order.Status = OrderStatus.Paid;
                order.StockDeducted = true; // từ thời điểm này, hủy đơn phải hoàn kho thật (CN-08.3)

            // Convert reserved stock into finalized deduction
            foreach (var item in order.Items)
            {
                var product = await _context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, cancellationToken);
                if (product != null)
                {
                    product.Stock = Math.Max(0, product.Stock - item.Quantity);
                    product.ReservedStock = Math.Max(0, product.ReservedStock - item.Quantity);
                }
            }

            // Record transaction history
            var paymentTx = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                OrderCode = order.OrderCode,
                Amount = payload.Data.Amount,
                Status = "PAID",
                PayOSTransactionId = payload.Data.Reference,
                Checksum = payload.Signature,
                CreatedAt = DateTime.UtcNow
            };

            // Record Order Status History
            var statusHistory = new OrderStatusHistory
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                Status = OrderStatus.Paid,
                Note = $"Thanh toán thành công qua PayOS (Mã GD: {payload.Data.Reference}). Đã trừ kho chính thức.",
                Timestamp = DateTime.UtcNow
            };

            // Create In-app Notification
            var notification = new Notification
            {
                Id = Guid.NewGuid(),
                UserId = order.UserId,
                Title = $"Đơn hàng #{order.OrderCode} đã thanh toán thành công!",
                Message = $"Cảm ơn quý khách {order.CustomerName}. Đơn hàng {order.TotalAmount:N0}đ đã được thanh toán qua PayOS và đang được đóng gói giao hàng.",
                Type = "Payment",
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            };

            await _context.PaymentTransactions.AddAsync(paymentTx, cancellationToken);
            await _context.OrderStatusHistories.AddAsync(statusHistory, cancellationToken);
            await _context.Notifications.AddAsync(notification, cancellationToken);
            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation("Order #{OrderCode} marked as PAID. Inventory permanently updated.", orderCode);

            // 4. SignalR Real-time notification dispatch
            var notifDto = new
            {
                Id = notification.Id,
                Title = notification.Title,
                Message = notification.Message,
                Type = notification.Type,
                IsRead = false,
                CreatedAt = notification.CreatedAt
            };
            if (order.UserId.HasValue)
            {
                await _hubContext.Clients.Group(NotificationGroups.ForUser(order.UserId.Value)).ReceiveNotification(notifDto);
            }
            await _hubContext.Clients.All.ReceiveOrderStatusUpdate(order.OrderCode, "Paid", "Thanh toán thành công qua PayOS!");

            // 5. Asynchronously stream event to Kafka topic 'payment-events'
            var orderPaidEvent = new OrderPaidEvent(
                order.OrderCode,
                order.Id,
                order.TotalAmount,
                order.CustomerEmail,
                DateTime.UtcNow);

            await _kafkaProducer.PublishAsync(
                "payment-events",
                order.OrderCode.ToString(),
                orderPaidEvent,
                cancellationToken);

            return ApiResponse<string>.Ok("Xử lý webhook thanh toán thành công.");
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogError(ex, "Lỗi xử lý webhook cho đơn hàng #{OrderCode}: {Message}", orderCode, ex.Message);
            return ApiResponse<string>.Fail("Lỗi nội bộ khi xác nhận thanh toán.");
        }
    });
}
}
