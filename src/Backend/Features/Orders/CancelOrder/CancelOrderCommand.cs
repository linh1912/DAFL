using DAFL.Backend.Common;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Orders.CancelOrder;

/// <summary>
/// Hủy đơn hàng (CN-08.3, đợt 13): khách hủy được từ Pending (COD) / Paid / Confirmed / Preparing.
/// Đơn Pending + PayOS (chưa thanh toán) KHÔNG hủy tay được — đơn tự chuyển Expired khi hết 15 phút giữ chỗ.
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

                // Đợt 13: hủy được từ Pending (COD) / Paid / Confirmed / Preparing — khớp
                // OrderStateMachine.CustomerCanCancel. Confirmed/Preparing đã trừ kho thật (COD)
                // hoặc đã Paid nên nhánh hoàn kho dưới đây (StockDeducted) xử lý đúng.
                var cancellable = order.Status is OrderStatus.Paid or OrderStatus.Confirmed or OrderStatus.Preparing
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
                else
                {
                    // PayOS đang giữ chỗ (chưa trừ thật): nhả giữ chỗ.
                    foreach (var item in order.Items)
                    {
                        var product = await _context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId, cancellationToken);
                        if (product != null)
                        {
                            product.ReservedStock = Math.Max(0, product.ReservedStock - item.Quantity);
                        }
                    }
                }

                // Hoàn điểm đã dùng + nhả lượt voucher — đúng 1 lần (idempotent, §11.2).
                await MembershipService.ReleaseOrderBenefitsAsync(_context, order, cancellationToken);

                var previousStatus = order.Status;
                order.Status = OrderStatus.Cancelled;
                order.CancelReason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
                order.CancelledAt = DateTime.UtcNow;

                _context.OrderStatusHistories.Add(new OrderStatusHistory
                {
                    Id = Guid.NewGuid(),
                    OrderId = order.Id,
                    Status = OrderStatus.Cancelled,
                    PreviousStatus = previousStatus,
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
