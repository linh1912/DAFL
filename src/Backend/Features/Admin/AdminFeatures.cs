using System.Globalization;
using System.Text;
using System.Text.Json;
using DAFL.Backend.Common;
using DAFL.Backend.Features.Products;
using DAFL.Backend.Infrastructure.Data;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Admin;

// ---------- Dashboard & báo cáo (§3) ----------

public record AdminDashboardDto(
    decimal RevenueToday, decimal RevenueThisMonth, int PendingOrders, int NewCustomers30d,
    Dictionary<string, int> OrdersByStatus,
    List<LowStockDto> LowStockProducts, List<ExpiringVoucherDto> ExpiringVouchers);

public record LowStockDto(Guid Id, string Name, int Stock);
public record ExpiringVoucherDto(string Code, int UsedCount, int? MaxUses, DateTime? ExpiryDate);

public record GetAdminDashboardQuery : IRequest<ApiResponse<AdminDashboardDto>>;

public class GetAdminDashboardQueryHandler : IRequestHandler<GetAdminDashboardQuery, ApiResponse<AdminDashboardDto>>
{
    private readonly AppDbContext _db;
    public GetAdminDashboardQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminDashboardDto>> Handle(GetAdminDashboardQuery request, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var today = now.Date;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        // Doanh thu chỉ tính đơn đã trả / đang xử lý / đã giao — không tính đơn hủy/hết hạn/chờ thanh toán (§3).
        var revenueStatuses = new[] { OrderStatus.Paid, OrderStatus.Confirmed, OrderStatus.Preparing, OrderStatus.Shipping, OrderStatus.Delivered, OrderStatus.Completed };

        // Cộng ở client: SQLite không Sum được decimal phía server (Postgres thì được).
        var revenueToday = (await _db.Orders.Where(o => revenueStatuses.Contains(o.Status) && o.CreatedAt >= today)
            .Select(o => o.TotalAmount).ToListAsync(ct)).Sum();
        var revenueMonth = (await _db.Orders.Where(o => revenueStatuses.Contains(o.Status) && o.CreatedAt >= monthStart)
            .Select(o => o.TotalAmount).ToListAsync(ct)).Sum();
        var pending = await _db.Orders.CountAsync(o => o.Status == OrderStatus.Pending || o.Status == OrderStatus.Paid, ct);
        var newCustomers = await _db.Users.CountAsync(u => u.Role == "Customer" && u.CreatedAt >= now.AddDays(-30), ct);
        var byStatus = await _db.Orders.GroupBy(o => o.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var lowStock = await _db.Products.Where(p => p.IsActive && !p.IsDeleted && p.Stock - p.ReservedStock < 5)
            .OrderBy(p => p.Stock).Take(10)
            .Select(p => new LowStockDto(p.Id, p.Name, p.Stock - p.ReservedStock)).ToListAsync(ct);
        var expiringVouchers = await _db.Vouchers
            .Where(v => v.IsActive && v.MaxUses.HasValue && (double)v.UsedCount / v.MaxUses.Value >= 0.8)
            .Select(v => new ExpiringVoucherDto(v.Code, v.UsedCount, v.MaxUses, v.ExpiryDate)).ToListAsync(ct);

        return ApiResponse<AdminDashboardDto>.Ok(new AdminDashboardDto(
            revenueToday, revenueMonth, pending, newCustomers,
            byStatus.ToDictionary(x => x.Key.ToString(), x => x.Count),
            lowStock, expiringVouchers));
    }
}

public record RevenueReportDto(
    List<DailyRevenueDto> ByDay, List<TopProductDto> TopProducts,
    int TotalOrders, int CancelledOrders, decimal CancelRate,
    int VoucherOrders, decimal VoucherUsageRate);

public record DailyRevenueDto(DateTime Date, decimal Revenue, int Orders);
public record TopProductDto(Guid ProductId, string ProductName, int Quantity, decimal Revenue);

public record GetRevenueReportQuery(DateTime? From, DateTime? To) : IRequest<ApiResponse<RevenueReportDto>>;

public class GetRevenueReportQueryHandler : IRequestHandler<GetRevenueReportQuery, ApiResponse<RevenueReportDto>>
{
    private readonly AppDbContext _db;
    public GetRevenueReportQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<RevenueReportDto>> Handle(GetRevenueReportQuery request, CancellationToken ct)
    {
        var to = (request.To ?? DateTime.UtcNow).Date.AddDays(1).AddTicks(-1);
        var from = (request.From ?? DateTime.UtcNow.AddDays(-30)).Date;
        if (to < from) (from, to) = (to.Date, from.Date.AddDays(1).AddTicks(-1));
        var revenueStatuses = new[] { OrderStatus.Paid, OrderStatus.Confirmed, OrderStatus.Preparing, OrderStatus.Shipping, OrderStatus.Delivered, OrderStatus.Completed };

        var orders = await _db.Orders.Where(o => o.CreatedAt >= from && o.CreatedAt <= to).ToListAsync(ct);
        var paidOrders = orders.Where(o => revenueStatuses.Contains(o.Status)).ToList();
        var byDay = paidOrders.GroupBy(o => o.CreatedAt.Date).OrderBy(g => g.Key)
            .Select(g => new DailyRevenueDto(g.Key, g.Sum(o => o.TotalAmount), g.Count())).ToList();
        var topProducts = await _db.OrderItems
            .Where(i => i.Order != null && revenueStatuses.Contains(i.Order.Status)
                && i.Order.CreatedAt >= from && i.Order.CreatedAt <= to)
            .GroupBy(i => new { i.ProductId, i.ProductName })
            .Select(g => new TopProductDto(g.Key.ProductId, g.Key.ProductName, g.Sum(i => i.Quantity), g.Sum(i => i.UnitPrice * i.Quantity)))
            .OrderByDescending(x => x.Quantity).Take(10).ToListAsync(ct);

        var total = orders.Count;
        var cancelled = orders.Count(o => o.Status == OrderStatus.Cancelled);
        var voucherOrders = paidOrders.Count(o => !string.IsNullOrEmpty(o.VoucherCode) || !string.IsNullOrEmpty(o.FreeShipVoucherCode));
        return ApiResponse<RevenueReportDto>.Ok(new RevenueReportDto(
            byDay, topProducts, total, cancelled,
            total == 0 ? 0 : Math.Round(100m * cancelled / total, 1),
            voucherOrders,
            paidOrders.Count == 0 ? 0 : Math.Round(100m * voucherOrders / paidOrders.Count, 1)));
    }
}

// ---------- Sản phẩm (§3.1) ----------

public record AdminProductDto(Guid Id, string Name, string Slug, Guid CategoryId, string CategoryName,
    decimal Price, decimal? OriginalPrice, int Stock, int ReservedStock, bool IsActive, string ImageUrl, DateTime CreatedAt,
    List<string> ImageUrls);

public record CreateProductCommand(
    string Name, Guid CategoryId, decimal Price, decimal? OriginalPrice, int Stock,
    string Description, string ImageUrl, string? Slug = null, List<string>? ImageUrls = null) : IRequest<ApiResponse<AdminProductDto>>;

public class CreateProductCommandValidator : AbstractValidator<CreateProductCommand>
{
    public CreateProductCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Tên sản phẩm không được để trống.")
            .Length(3, 120).WithMessage("Tên sản phẩm phải có từ 3 đến 120 ký tự.");
        RuleFor(x => x.Price).GreaterThan(0).WithMessage("Giá bán phải lớn hơn 0.");
        RuleFor(x => x.OriginalPrice).GreaterThan(x => x.Price)
            .When(x => x.OriginalPrice.HasValue).WithMessage("Giá gốc phải lớn hơn giá bán.");
        RuleFor(x => x.Stock).GreaterThanOrEqualTo(0).WithMessage("Tồn kho không được âm.");
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage("Sản phẩm phải thuộc 1 danh mục.");
        RuleFor(x => x.Description).MaximumLength(5000).WithMessage("Mô tả tối đa 5000 ký tự.");
        RuleFor(x => x.ImageUrl).MaximumLength(1000).WithMessage("Đường dẫn ảnh quá dài.");
        RuleForEach(x => x.ImageUrls).MaximumLength(1000).WithMessage("Đường dẫn ảnh quá dài.")
            .When(x => x.ImageUrls != null);
    }
}

public class CreateProductCommandHandler : IRequestHandler<CreateProductCommand, ApiResponse<AdminProductDto>>
{
    private readonly AppDbContext _db;
    public CreateProductCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminProductDto>> Handle(CreateProductCommand request, CancellationToken ct)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == request.CategoryId, ct);
        if (category == null) return ApiResponse<AdminProductDto>.Fail("Danh mục không tồn tại.");
        if (!category.IsActive) return ApiResponse<AdminProductDto>.Fail("Sản phẩm phải thuộc 1 danh mục đang hiển thị.");

        var slug = string.IsNullOrWhiteSpace(request.Slug) ? Slugify(request.Name) : Slugify(request.Slug);
        if (await _db.Products.AnyAsync(p => p.Slug == slug, ct))
            return ApiResponse<AdminProductDto>.Fail("Slug sản phẩm đã tồn tại.");

        // Thư viện ảnh (đợt redesign form admin): ImageUrls → ImagesJson (JSON).
        // Tương thích cũ: client chỉ gửi ImageUrl như trước thì ImagesJson giữ null,
        // hành vi không đổi; nếu ImageUrl rỗng mà có ImageUrls thì ảnh đầu tiên làm đại diện.
        var imageUrls = CleanImageUrls(request.ImageUrls);
        var imageUrl = request.ImageUrl ?? string.Empty;
        if (string.IsNullOrWhiteSpace(imageUrl) && imageUrls.Count > 0) imageUrl = imageUrls[0];

        // Sản phẩm mới lưu ở trạng thái hiển thị ngay (IsActive = true) như hành vi seed;
        // admin tắt bằng nút Ẩn / Xóa mềm khi cần (§3.1: Draft chỉ là quy ước hiển thị, chưa có cột trạng thái riêng).
        var product = new Product
        {
            Id = Guid.NewGuid(), Name = request.Name.Trim(), Slug = slug, CategoryId = category.Id,
            Price = request.Price, OriginalPrice = request.OriginalPrice, Stock = request.Stock,
            Description = request.Description ?? string.Empty, ImageUrl = imageUrl,
            ImagesJson = imageUrls.Count > 0 ? JsonSerializer.Serialize(imageUrls) : null,
            IsActive = true, CreatedAt = DateTime.UtcNow
        };
        _db.Products.Add(product);
        await _db.SaveChangesAsync(ct);
        return ApiResponse<AdminProductDto>.Ok(ToDto(product, category.Name), "Tạo sản phẩm thành công.");
    }

    /// <summary>Chuẩn hóa danh sách URL ảnh: bỏ rỗng/khoảng trắng, trim, khử trùng, giữ thứ tự.</summary>
    public static List<string> CleanImageUrls(List<string>? imageUrls)
        => (imageUrls ?? new List<string>())
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .Select(u => u.Trim())
            .Distinct()
            .ToList();

    public static AdminProductDto ToDto(Product p, string categoryName) => new(
        p.Id, p.Name, p.Slug, p.CategoryId, categoryName, p.Price, p.OriginalPrice,
        p.Stock, p.ReservedStock, p.IsActive, p.ImageUrl, p.CreatedAt,
        GetProductDetailQueryHandler.ParseImages(p.ImagesJson, p.ImageUrl));

    public static string Slugify(string value)
    {
        var normalized = value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var ch in normalized)
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat == UnicodeCategory.NonSpacingMark) continue;
            if (ch == 'đ') { sb.Append('d'); continue; }
            if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            else if (ch is ' ' or '-' or '_') sb.Append('-');
        }
        var slug = sb.ToString();
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        return slug.Trim('-');
    }
}

public record UpdateProductCommand(
    Guid Id, string Name, Guid CategoryId, decimal Price, decimal? OriginalPrice, int Stock,
    string Description, string ImageUrl, bool IsActive, List<string>? ImageUrls = null) : IRequest<ApiResponse<AdminProductDto>>;

public class UpdateProductCommandValidator : AbstractValidator<UpdateProductCommand>
{
    public UpdateProductCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().Length(3, 120).WithMessage("Tên sản phẩm phải có từ 3 đến 120 ký tự.");
        RuleFor(x => x.Price).GreaterThan(0).WithMessage("Giá bán phải lớn hơn 0.");
        RuleFor(x => x.OriginalPrice).GreaterThan(x => x.Price)
            .When(x => x.OriginalPrice.HasValue).WithMessage("Giá gốc phải lớn hơn giá bán.");
        RuleFor(x => x.Stock).GreaterThanOrEqualTo(0).WithMessage("Tồn kho không được âm.");
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage("Sản phẩm phải thuộc 1 danh mục.");
        RuleForEach(x => x.ImageUrls).MaximumLength(1000).WithMessage("Đường dẫn ảnh quá dài.")
            .When(x => x.ImageUrls != null);
    }
}

public class UpdateProductCommandHandler : IRequestHandler<UpdateProductCommand, ApiResponse<AdminProductDto>>
{
    private readonly AppDbContext _db;
    public UpdateProductCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminProductDto>> Handle(UpdateProductCommand request, CancellationToken ct)
    {
        var product = await _db.Products.Include(p => p.Category).FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (product == null || product.IsDeleted) return ApiResponse<AdminProductDto>.Fail("Không tìm thấy sản phẩm.");
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == request.CategoryId, ct);
        if (category == null) return ApiResponse<AdminProductDto>.Fail("Danh mục không tồn tại.");
        if (!category.IsActive) return ApiResponse<AdminProductDto>.Fail("Sản phẩm phải thuộc 1 danh mục đang hiển thị.");

        product.Name = request.Name.Trim();
        product.CategoryId = request.CategoryId;
        product.Price = request.Price;
        product.OriginalPrice = request.OriginalPrice;
        product.Stock = request.Stock;
        product.Description = request.Description ?? string.Empty;
        // Thư viện ảnh (đợt redesign form admin): chỉ khi client gửi ImageUrls thì mới
        // động tới ImagesJson (gửi [] = xóa hết thư viện); gửi null = giữ nguyên thư
        // viện cũ (tương thích client cũ chỉ gửi ImageUrl). ImageUrl rỗng + có ImageUrls
        // thì ảnh đầu tiên làm đại diện, như lúc tạo mới.
        if (request.ImageUrls != null)
        {
            var imageUrls = CreateProductCommandHandler.CleanImageUrls(request.ImageUrls);
            product.ImagesJson = imageUrls.Count > 0 ? JsonSerializer.Serialize(imageUrls) : null;
            product.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) && imageUrls.Count > 0
                ? imageUrls[0] : (request.ImageUrl ?? string.Empty);
        }
        else
        {
            product.ImageUrl = request.ImageUrl ?? string.Empty;
        }
        product.IsActive = request.IsActive;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<AdminProductDto>.Ok(CreateProductCommandHandler.ToDto(product, category.Name), "Cập nhật sản phẩm thành công.");
    }
}

/// <summary>Xóa mềm (§3.1): sản phẩm đã từng có đơn chỉ ẩn + đánh dấu IsDeleted, giữ lịch sử đơn nguyên vẹn.</summary>
public record DeleteProductCommand(Guid Id) : IRequest<ApiResponse<string>>;

public class DeleteProductCommandHandler : IRequestHandler<DeleteProductCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public DeleteProductCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(DeleteProductCommand request, CancellationToken ct)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (product == null || product.IsDeleted) return ApiResponse<string>.Fail("Không tìm thấy sản phẩm.");
        product.IsActive = false;
        product.IsDeleted = true;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã xóa sản phẩm (xóa mềm — lịch sử đơn được giữ nguyên).");
    }
}

// ---------- Danh mục (§3) ----------

public record AdminCategoryDto(Guid Id, string Name, string Slug, string? Description, bool IsActive, int SortOrder, int ProductCount, string? IconUrl = null);

public record CreateCategoryCommand(string Name, string? Description, string? Slug = null, int SortOrder = 0, string? IconUrl = null)
    : IRequest<ApiResponse<AdminCategoryDto>>;

public class CreateCategoryCommandValidator : AbstractValidator<CreateCategoryCommand>
{
    public CreateCategoryCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().Length(2, 150).WithMessage("Tên danh mục phải có từ 2 đến 150 ký tự.");
        RuleFor(x => x.Description).MaximumLength(1000).WithMessage("Mô tả tối đa 1000 ký tự.");
        RuleFor(x => x.IconUrl).MaximumLength(500).WithMessage("Đường dẫn icon quá dài.");
    }
}

public class CreateCategoryCommandHandler : IRequestHandler<CreateCategoryCommand, ApiResponse<AdminCategoryDto>>
{
    private readonly AppDbContext _db;
    public CreateCategoryCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminCategoryDto>> Handle(CreateCategoryCommand request, CancellationToken ct)
    {
        var slug = string.IsNullOrWhiteSpace(request.Slug) ? CreateProductCommandHandler.Slugify(request.Name) : CreateProductCommandHandler.Slugify(request.Slug);
        if (await _db.Categories.AnyAsync(c => c.Slug == slug, ct))
            return ApiResponse<AdminCategoryDto>.Fail("Slug danh mục đã tồn tại.");
        var category = new Category
        {
            Id = Guid.NewGuid(), Name = request.Name.Trim(), Slug = slug,
            Description = request.Description?.Trim(), IsActive = true, SortOrder = request.SortOrder,
            IconUrl = string.IsNullOrWhiteSpace(request.IconUrl) ? null : request.IconUrl.Trim(),
            CreatedAt = DateTime.UtcNow
        };
        _db.Categories.Add(category);
        await _db.SaveChangesAsync(ct);
        return ApiResponse<AdminCategoryDto>.Ok(new AdminCategoryDto(category.Id, category.Name, category.Slug, category.Description, category.IsActive, category.SortOrder, 0, category.IconUrl), "Tạo danh mục thành công.");
    }
}

public record UpdateCategoryCommand(Guid Id, string Name, string? Description, bool IsActive, int SortOrder, string? Slug = null, string? IconUrl = null)
    : IRequest<ApiResponse<AdminCategoryDto>>;

public class UpdateCategoryCommandValidator : AbstractValidator<UpdateCategoryCommand>
{
    public UpdateCategoryCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().Length(2, 150).WithMessage("Tên danh mục phải có từ 2 đến 150 ký tự.");
        RuleFor(x => x.Slug).MaximumLength(150).WithMessage("Slug tối đa 150 ký tự.");
        RuleFor(x => x.IconUrl).MaximumLength(500).WithMessage("Đường dẫn icon quá dài.");
    }
}

public class UpdateCategoryCommandHandler : IRequestHandler<UpdateCategoryCommand, ApiResponse<AdminCategoryDto>>
{
    private readonly AppDbContext _db;
    public UpdateCategoryCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<AdminCategoryDto>> Handle(UpdateCategoryCommand request, CancellationToken ct)
    {
        var category = await _db.Categories.Include(c => c.Products).FirstOrDefaultAsync(c => c.Id == request.Id, ct);
        if (category == null) return ApiResponse<AdminCategoryDto>.Fail("Không tìm thấy danh mục.");
        category.Name = request.Name.Trim();
        category.Description = request.Description?.Trim();
        category.IsActive = request.IsActive;
        category.SortOrder = request.SortOrder;
        // Slug/IconUrl (đợt redesign form admin): null = giữ nguyên; Slug chỉ đổi khi
        // gửi lên khác rỗng (kiểm tra trùng trừ chính nó), IconUrl gửi "" = xóa icon.
        if (!string.IsNullOrWhiteSpace(request.Slug))
        {
            var slug = CreateProductCommandHandler.Slugify(request.Slug);
            if (string.IsNullOrWhiteSpace(slug)) return ApiResponse<AdminCategoryDto>.Fail("Slug không hợp lệ.");
            if (slug != category.Slug && await _db.Categories.AnyAsync(c => c.Slug == slug, ct))
                return ApiResponse<AdminCategoryDto>.Fail("Slug danh mục đã tồn tại.");
            category.Slug = slug;
        }
        if (request.IconUrl != null)
            category.IconUrl = string.IsNullOrWhiteSpace(request.IconUrl) ? null : request.IconUrl.Trim();
        await _db.SaveChangesAsync(ct);
        var count = await _db.Products.CountAsync(p => p.CategoryId == category.Id && !p.IsDeleted, ct);
        return ApiResponse<AdminCategoryDto>.Ok(new AdminCategoryDto(category.Id, category.Name, category.Slug, category.Description, category.IsActive, category.SortOrder, count, category.IconUrl), "Cập nhật danh mục thành công.");
    }
}

public record DeleteCategoryCommand(Guid Id) : IRequest<ApiResponse<string>>;

public class DeleteCategoryCommandHandler : IRequestHandler<DeleteCategoryCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public DeleteCategoryCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(DeleteCategoryCommand request, CancellationToken ct)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == request.Id, ct);
        if (category == null) return ApiResponse<string>.Fail("Không tìm thấy danh mục.");
        // Không xóa được danh mục đang có sản phẩm (§3).
        if (await _db.Products.AnyAsync(p => p.CategoryId == category.Id && !p.IsDeleted, ct))
            return ApiResponse<string>.Fail("Không thể xóa danh mục đang có sản phẩm. Hãy chuyển hoặc xóa sản phẩm trước.");
        _db.Categories.Remove(category);
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã xóa danh mục.");
    }
}

// ---------- Khách hàng (§3): xem hồ sơ + khóa/mở khóa ----------

public record AdminCustomerDto(Guid Id, string Email, string FullName, string? PhoneNumber,
    string Role, bool IsLocked, string MembershipTier, decimal TotalSpent12m, int OrderCount,
    DateTime CreatedAt, DateTime? LastLoginAt, int AvailablePoints);

public record ListCustomersQuery(string? Search, string? Tier, int Page = 1, int PageSize = 20)
    : IRequest<ApiResponse<List<AdminCustomerDto>>>;

public class ListCustomersQueryHandler : IRequestHandler<ListCustomersQuery, ApiResponse<List<AdminCustomerDto>>>
{
    private readonly AppDbContext _db;
    public ListCustomersQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<AdminCustomerDto>>> Handle(ListCustomersQuery request, CancellationToken ct)
    {
        var query = _db.Users.AsNoTracking().Where(u => u.Role == "Customer").AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var s = request.Search.Trim().ToLower();
            query = query.Where(u => u.Email.ToLower().Contains(s) || u.FullName.ToLower().Contains(s)
                || (u.PhoneNumber != null && u.PhoneNumber.Contains(s)));
        }
        if (!string.IsNullOrWhiteSpace(request.Tier))
            query = query.Where(u => u.MembershipTier == request.Tier.Trim());
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var users = await query.OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var ids = users.Select(u => u.Id).ToList();
        var counts = await _db.Orders.Where(o => o.UserId.HasValue && ids.Contains(o.UserId.Value))
            .GroupBy(o => o.UserId!.Value).Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count, ct);
        // Số dư điểm khả dụng (đợt 13): tổng RemainingPoints của các lô dương chưa hết hạn
        // — cùng định nghĩa với MembershipService.AvailablePointsAsync, tính gộp 1 query cho cả trang.
        var now = DateTime.UtcNow;
        var points = await _db.PointTransactions
            .Where(p => ids.Contains(p.UserId) && p.RemainingPoints.HasValue && p.RemainingPoints.Value > 0
                && (p.ExpiresAt == null || p.ExpiresAt.Value > now))
            .GroupBy(p => p.UserId)
            .Select(g => new { UserId = g.Key, Points = g.Sum(p => p.RemainingPoints ?? 0) })
            .ToDictionaryAsync(x => x.UserId, x => x.Points, ct);
        return ApiResponse<List<AdminCustomerDto>>.Ok(users.Select(u => new AdminCustomerDto(
            u.Id, u.Email, u.FullName, u.PhoneNumber, u.Role, u.IsLocked, u.MembershipTier,
            u.TotalSpent12m, counts.GetValueOrDefault(u.Id), u.CreatedAt, u.LastLoginAt,
            points.GetValueOrDefault(u.Id))).ToList());
    }
}

public record LockCustomerCommand(Guid UserId, string? Reason) : IRequest<ApiResponse<string>>;

public class LockCustomerCommandHandler : IRequestHandler<LockCustomerCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public LockCustomerCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(LockCustomerCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<string>.Fail("Không tìm thấy tài khoản.");
        if (user.Role != "Customer") return ApiResponse<string>.Fail("Không thể khóa tài khoản quản trị.");
        if (user.IsLocked) return ApiResponse<string>.Fail("Tài khoản đã bị khóa trước đó.");
        user.IsLocked = true;
        user.TokenVersion++; // hủy JWT đang sống của tài khoản bị khóa
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã khóa tài khoản. Tài khoản bị khóa không đăng nhập và không checkout được.");
    }
}

public record UnlockCustomerCommand(Guid UserId) : IRequest<ApiResponse<string>>;

public class UnlockCustomerCommandHandler : IRequestHandler<UnlockCustomerCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public UnlockCustomerCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(UnlockCustomerCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user == null) return ApiResponse<string>.Fail("Không tìm thấy tài khoản.");
        if (!user.IsLocked) return ApiResponse<string>.Fail("Tài khoản không bị khóa.");
        user.IsLocked = false;
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đã mở khóa tài khoản.");
    }
}

// ---------- Nhật ký hệ thống (§3): chỉ đọc ----------

public record AuditLogDto(Guid Id, string ActorEmail, string Action, string? EntityType, string? EntityId,
    string? OldValueJson, string? NewValueJson, string? IpAddress, DateTime CreatedAt);

public record ListAuditLogQuery(string? Action, Guid? ActorId, DateTime? From, DateTime? To, int Page = 1, int PageSize = 20)
    : IRequest<ApiResponse<List<AuditLogDto>>>;

public class ListAuditLogQueryHandler : IRequestHandler<ListAuditLogQuery, ApiResponse<List<AuditLogDto>>>
{
    private readonly AppDbContext _db;
    public ListAuditLogQueryHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<List<AuditLogDto>>> Handle(ListAuditLogQuery request, CancellationToken ct)
    {
        var query = _db.AuditLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Action)) query = query.Where(a => a.Action == request.Action.Trim());
        if (request.ActorId.HasValue) query = query.Where(a => a.ActorId == request.ActorId.Value);
        if (request.From.HasValue) query = query.Where(a => a.CreatedAt >= request.From.Value);
        if (request.To.HasValue) query = query.Where(a => a.CreatedAt <= request.To.Value);
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var logs = await query.OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new AuditLogDto(a.Id, a.ActorEmail, a.Action, a.EntityType, a.EntityId,
                a.OldValueJson, a.NewValueJson, a.IpAddress, a.CreatedAt)).ToListAsync(ct);
        return ApiResponse<List<AuditLogDto>>.Ok(logs);
    }
}
