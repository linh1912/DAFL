using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Vouchers;

public record VoucherDto(Guid Id, string Code, string Description, string DiscountType, decimal DiscountValue, decimal MinOrderAmount, decimal? MaxDiscountAmount);

public record ApplyVoucherResultDto(string Code, decimal SubTotal, decimal DiscountAmount, decimal FinalTotal, string Message);

// 1. Get Available Vouchers
public record GetVouchersQuery : IRequest<ApiResponse<List<VoucherDto>>>;

public class GetVouchersQueryHandler : IRequestHandler<GetVouchersQuery, ApiResponse<List<VoucherDto>>>
{
    private readonly AppDbContext _context;

    public GetVouchersQueryHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<List<VoucherDto>>> Handle(GetVouchersQuery request, CancellationToken cancellationToken)
    {
        var vouchers = await _context.Vouchers
            .AsNoTracking()
            .Where(v => v.IsActive && (!v.ExpiryDate.HasValue || v.ExpiryDate.Value > DateTime.UtcNow))
            .Select(v => new VoucherDto(v.Id, v.Code, v.Description, v.DiscountType, v.DiscountValue, v.MinOrderAmount, v.MaxDiscountAmount))
            .ToListAsync(cancellationToken);

        return ApiResponse<List<VoucherDto>>.Ok(vouchers);
    }
}

// 2. Apply Voucher
public record ApplyVoucherCommand(string Code, decimal CartAmount) : IRequest<ApiResponse<ApplyVoucherResultDto>>;

public class ApplyVoucherCommandHandler : IRequestHandler<ApplyVoucherCommand, ApiResponse<ApplyVoucherResultDto>>
{
    private readonly AppDbContext _context;

    public ApplyVoucherCommandHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<ApplyVoucherResultDto>> Handle(ApplyVoucherCommand request, CancellationToken cancellationToken)
    {
        var code = request.Code.Trim().ToUpperInvariant();
        var voucher = await _context.Vouchers
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.Code == code && v.IsActive, cancellationToken);

        if (voucher == null)
        {
            return ApiResponse<ApplyVoucherResultDto>.Fail("Mã giảm giá không tồn tại hoặc đã hết hiệu lực.");
        }

        if (voucher.ExpiryDate.HasValue && voucher.ExpiryDate.Value < DateTime.UtcNow)
        {
            return ApiResponse<ApplyVoucherResultDto>.Fail("Mã giảm giá đã hết hạn sử dụng.");
        }

        if (request.CartAmount < voucher.MinOrderAmount)
        {
            return ApiResponse<ApplyVoucherResultDto>.Fail($"Đơn hàng tối thiểu cần đạt {voucher.MinOrderAmount:N0}đ để áp dụng mã {voucher.Code}.");
        }

        if (voucher.MaxUses.HasValue && voucher.UsedCount >= voucher.MaxUses.Value)
        {
            return ApiResponse<ApplyVoucherResultDto>.Fail("Mã giảm giá đã hết lượt sử dụng.");
        }

        decimal discountAmount = 0;
        if (voucher.Code == "FORDEV")
        {
            // Special dev voucher: Reduce total order to exactly 2,000 VND for PayOS testing
            discountAmount = Math.Max(0, request.CartAmount - 2000m);
        }
        else if (voucher.DiscountType == "Percentage")
        {
            discountAmount = request.CartAmount * (voucher.DiscountValue / 100m);
            if (voucher.MaxDiscountAmount.HasValue && discountAmount > voucher.MaxDiscountAmount.Value)
            {
                discountAmount = voucher.MaxDiscountAmount.Value;
            }
        }
        else
        {
            discountAmount = voucher.DiscountValue;
        }

        if (discountAmount > request.CartAmount)
        {
            discountAmount = request.CartAmount;
        }

        var finalTotal = Math.Max(0, request.CartAmount - discountAmount);

        var message = voucher.Code == "FORDEV"
            ? "Áp dụng mã FORDEV thành công! Đơn hàng được trợ giá chỉ còn 2.000đ để bạn test thanh toán PayOS."
            : $"Áp dụng mã {voucher.Code} thành công! Bạn được giảm {discountAmount:N0}đ.";

        var result = new ApplyVoucherResultDto(
            voucher.Code,
            request.CartAmount,
            discountAmount,
            finalTotal,
            message
        );

        return ApiResponse<ApplyVoucherResultDto>.Ok(result, result.Message);
    }
}
