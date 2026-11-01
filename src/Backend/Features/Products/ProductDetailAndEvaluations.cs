using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Products;

public record EvaluationDto(Guid Id, Guid ProductId, string UserName, int Rating, string Comment, DateTime CreatedAt);

public record ProductDetailDto(
    Guid Id,
    Guid CategoryId,
    string CategoryName,
    string Name,
    string Slug,
    string Description,
    decimal Price,
    decimal? OriginalPrice,
    int Stock,
    int AvailableStock,
    string ImageUrl,
    List<string> Images,
    double Rating,
    int ReviewCount,
    List<EvaluationDto> Evaluations
);

// Query: Get Product Detail
public record GetProductDetailQuery(Guid ProductId) : IRequest<ApiResponse<ProductDetailDto>>;

public class GetProductDetailQueryHandler : IRequestHandler<GetProductDetailQuery, ApiResponse<ProductDetailDto>>
{
    private readonly AppDbContext _context;

    public GetProductDetailQueryHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<ProductDetailDto>> Handle(GetProductDetailQuery request, CancellationToken cancellationToken)
    {
        var product = await _context.Products
            .AsNoTracking()
            .Include(p => p.Category)
            .Include(p => p.Evaluations)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        // CN-05 E1: sản phẩm không tồn tại HOẶC đã ngừng bán → coi như không tìm thấy (404 phía endpoint)
        if (product == null || !product.IsActive)
        {
            return ApiResponse<ProductDetailDto>.Fail("Không tìm thấy sản phẩm.");
        }

        var evaluations = product.Evaluations
            .OrderByDescending(e => e.CreatedAt)
            .Select(e => new EvaluationDto(e.Id, e.ProductId, e.UserName, e.Rating, e.Comment, e.CreatedAt))
            .ToList();

        var dto = new ProductDetailDto(
            product.Id,
            product.CategoryId,
            product.Category?.Name ?? "Khác",
            product.Name,
            product.Slug,
            product.Description,
            product.Price,
            product.OriginalPrice,
            product.Stock,
            product.Stock - product.ReservedStock,
            product.ImageUrl,
            ParseImages(product.ImagesJson, product.ImageUrl),
            product.Rating,
            product.ReviewCount,
            evaluations
        );

        return ApiResponse<ProductDetailDto>.Ok(dto);
    }

    /// <summary>
    /// Danh sách ảnh của sản phẩm: ảnh đại diện luôn đứng đầu, bỏ ảnh trùng/rỗng; JSON hỏng hoặc trống thì chỉ còn ảnh đại diện.
    /// </summary>
    public static List<string> ParseImages(string? imagesJson, string mainImageUrl)
    {
        var images = new List<string>();
        if (!string.IsNullOrWhiteSpace(mainImageUrl)) images.Add(mainImageUrl);

        if (!string.IsNullOrWhiteSpace(imagesJson))
        {
            try
            {
                var extra = JsonSerializer.Deserialize<List<string>>(imagesJson) ?? new List<string>();
                images.AddRange(extra.Where(u => !string.IsNullOrWhiteSpace(u) && !images.Contains(u)));
            }
            catch (JsonException)
            {
                // ImagesJson sai định dạng: bỏ qua, vẫn hiển thị ảnh đại diện
            }
        }

        return images.Distinct().ToList();
    }
}

// Command: Add Evaluation (Product Review)
public record AddEvaluationCommand(Guid ProductId, Guid? UserId, string UserName, int Rating, string Comment) 
    : IRequest<ApiResponse<EvaluationDto>>;

public class AddEvaluationCommandHandler : IRequestHandler<AddEvaluationCommand, ApiResponse<EvaluationDto>>
{
    private readonly AppDbContext _context;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;

    public AddEvaluationCommandHandler(AppDbContext context, IHubContext<NotificationHub, INotificationClient> hubContext)
    {
        _context = context;
        _hubContext = hubContext;
    }

    public async Task<ApiResponse<EvaluationDto>> Handle(AddEvaluationCommand request, CancellationToken cancellationToken)
    {
        if (request.Rating < 1 || request.Rating > 5)
        {
            return ApiResponse<EvaluationDto>.Fail("Đánh giá phải từ 1 đến 5 sao.");
        }

        var product = await _context.Products
            .Include(p => p.Evaluations)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return ApiResponse<EvaluationDto>.Fail("Không tìm thấy sản phẩm.");
        }

        var evaluation = new Evaluation
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            UserId = request.UserId,
            UserName = string.IsNullOrWhiteSpace(request.UserName) ? "Khách hàng DAFL" : request.UserName.Trim(),
            Rating = request.Rating,
            Comment = request.Comment.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _context.Evaluations.Add(evaluation);
        product.Evaluations.Add(evaluation);
        product.ReviewCount = product.Evaluations.Count;
        product.Rating = Math.Round(product.Evaluations.Average(e => e.Rating), 1);

        await _context.SaveChangesAsync(cancellationToken);

        // Real-time notification via SignalR
        var notif = new
        {
            Title = "Đánh giá mới",
            Message = $"{evaluation.UserName} vừa đánh giá {evaluation.Rating}⭐ cho '{product.Name}': \"{evaluation.Comment}\"",
            Type = "System",
            CreatedAt = DateTime.UtcNow
        };
        await _hubContext.Clients.All.ReceiveNotification(notif);

        var dto = new EvaluationDto(evaluation.Id, evaluation.ProductId, evaluation.UserName, evaluation.Rating, evaluation.Comment, evaluation.CreatedAt);
        return ApiResponse<EvaluationDto>.Ok(dto, "Cảm ơn bạn đã gửi đánh giá cho sản phẩm!");
    }
}
