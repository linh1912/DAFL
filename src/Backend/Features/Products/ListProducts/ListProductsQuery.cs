using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Products.ListProducts;

public record ProductDto(
    Guid Id,
    Guid CategoryId,
    string CategoryName,
    string Name,
    string Slug,
    string Description,
    decimal Price,
    decimal? OriginalPrice,
    int AvailableStock,
    string ImageUrl,
    double Rating,
    int ReviewCount);

public record ListProductsQuery(
    Guid? CategoryId = null,
    string? Search = null,
    int? Page = null,
    int? PageSize = null,
    decimal? PriceFrom = null,
    decimal? PriceTo = null,
    string? Sort = null)
    : IRequest<ApiResponse<List<ProductDto>>>, ICacheableQuery
{
    public string CacheKey => $"products:cat={CategoryId}:q={Search?.Trim().ToLowerInvariant()}:p={Page}:s={PageSize}:pf={PriceFrom}:pt={PriceTo}:sort={Sort}";
    public TimeSpan? Expiration => TimeSpan.FromMinutes(10);
}

public class ListProductsQueryHandler : IRequestHandler<ListProductsQuery, ApiResponse<List<ProductDto>>>
{
    private readonly AppDbContext _context;

    public ListProductsQueryHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<List<ProductDto>>> Handle(ListProductsQuery request, CancellationToken cancellationToken)
    {
        // CN-04: sản phẩm ngừng bán (IsActive = false) không hiển thị
        var query = _context.Products
            .AsNoTracking()
            .Include(p => p.Category)
            .Where(p => p.IsActive && !p.IsDeleted)
            .AsQueryable();

        if (request.CategoryId.HasValue && request.CategoryId.Value != Guid.Empty)
        {
            query = query.Where(p => p.CategoryId == request.CategoryId.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // Tìm theo tên, không phân biệt hoa thường; EF dịch thành truy vấn tham số hóa (chống SQL Injection — CN-04 E3)
            var search = request.Search.Trim().ToLower();
            query = query.Where(p => p.Name.ToLower().Contains(search) || p.Description.ToLower().Contains(search));
        }

        // Lọc theo khoảng giá (CN-04)
        if (request.PriceFrom.HasValue)
        {
            query = query.Where(p => p.Price >= request.PriceFrom.Value);
        }

        if (request.PriceTo.HasValue)
        {
            query = query.Where(p => p.Price <= request.PriceTo.Value);
        }

        // Sắp xếp (CN-04): mặc định mới nhất; price-asc = giá tăng dần; price-desc = giá giảm dần
        query = request.Sort switch
        {
            "price-asc" => query.OrderBy(p => p.Price).ThenByDescending(p => p.CreatedAt),
            "price-desc" => query.OrderByDescending(p => p.Price).ThenByDescending(p => p.CreatedAt),
            _ => query.OrderByDescending(p => p.CreatedAt)
        };

        // Phân trang CN-04: mặc định 12 sản phẩm/trang khi client không truyền tham số
        var page = request.Page.HasValue && request.Page.Value > 0 ? request.Page.Value : 1;
        var pageSize = request.PageSize.HasValue && request.PageSize.Value > 0 ? request.PageSize.Value : 12;
        query = query.Skip((page - 1) * pageSize).Take(pageSize);

        var products = await query
            .Select(p => new ProductDto(
                p.Id,
                p.CategoryId,
                p.Category != null ? p.Category.Name : string.Empty,
                p.Name,
                p.Slug,
                p.Description,
                p.Price,
                p.OriginalPrice,
                p.Stock - p.ReservedStock,
                p.ImageUrl,
                p.Rating,
                p.ReviewCount))
            .ToListAsync(cancellationToken);

        return ApiResponse<List<ProductDto>>.Ok(products);
    }
}
