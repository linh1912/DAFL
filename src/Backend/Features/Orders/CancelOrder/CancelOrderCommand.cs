using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders.CancelOrder;

/// <summary>
/// Hủy đơn hàng (CN-08.3): chỉ hủy được khi đơn đang ở "Chờ xác nhận"
/// (COD chưa xử lý — Status Pending + COD, hoặc PayOS đã thanh toán — Status Paid).
/// Trong một transaction: → Đã hủy, lưu lý do + thời điểm hủy, hoàn tồn kho theo từng dòng.
/// Hủy lần hai / hủy ở trạng thái khác → "Đơn không còn có thể hủy" và KHÔNG hoàn kho lại (idempotent).
/// </summary>
public record CancelOrderCommand(Guid UserId, Guid OrderId, string? Reason) : IRequest<ApiResponse<string>>;

public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, ApiResponse<string>>
{
    private readonly AppDbContext _context;

    public CancelOrderCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<string>> Handle(CancelOrderCommand request, CancellationToken cancellationToken)
    {
        var strategy = _context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                var order = await _context.Orders
                    .Include(o => o.Items)
                    .FirstOrDefaultAsync(o => o.Id == request.OrderId, cancellationToken);

                if (order == null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return ApiResponse<string>.Fail("Không tìm thấy đơn hàng.");
                }

                // CN-08 E3: hủy đơn của người khác → từ chối quyền
                if (order.UserId != request.UserId)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return ApiResponse<string>.Fail("Không có quyền truy cập đơn hàng này.");
                }

                var cancellable = order.Status == OrderStatus.Paid
                    || (order.Status == OrderStatus.Pending && order.PaymentMethod == "COD");
                if (!cancellable)
                {
                    // Gồm cả trường hợp đơn đã hủy (E2) và trạng thái đã bị admin đổi (E1)
                    await transaction.RollbackAsync(cancellationToken);
                    return ApiResponse<string>.Fail("Đơn không còn có thể hủy");
                }

                // Hoàn tồn kho theo từng dòng — chỉ khi kho đã thực sự bị trừ (StockDeducted).
                if (order.StockDeducted)
                {
                    foreach (var item in order.Items)
                    {
                        var product = await _context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, cancellationToken);
                        if (product != null)
                        {
                            product.Stock += item.Quantity;
                        }
                    }
                }

                order.Status = OrderStatus.Cancelled;
                order.CancelReason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
                order.CancelledAt = DateTime.UtcNow;

                _context.OrderStatusHistories.Add(new OrderStatusHistory
                {
                    Id = Guid.NewGuid(),
                    OrderId = order.Id,
                    Status = OrderStatus.Cancelled,
                    Note = string.IsNullOrWhiteSpace(order.CancelReason)
                        ? "Khách hàng hủy đơn"
                        : $"Khách hàng hủy đơn. Lý do: {order.CancelReason}",
                    Timestamp = DateTime.UtcNow
                });

                await _context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                return ApiResponse<string>.Ok("Hủy đơn thành công");
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ApiResponse<string>.Fail("Không thể hủy đơn hàng: " + ex.Message);
            }
        });
    }
}
