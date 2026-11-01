using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Cart;

// ==========================================
// CN-06 — Giỏ hàng phía server theo tài khoản (đã đăng nhập bằng JWT).
// Giỏ khách vãng lai nằm ở localStorage phía FE; khi đăng nhập, FE gọi /api/cart/merge để gộp.
// Mỗi lần đọc giỏ: đồng bộ giá + tồn kho mới nhất và đánh dấu dòng không còn mua được (CN-06.5).
// "Biến thể" trong đặc tả ánh xạ tới ProductId — schema hiện tại mỗi sản phẩm là một biến thể duy nhất.
// ==========================================

public record CartItemDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string ProductImageUrl,
    decimal UnitPrice,
    int Quantity,
    decimal SubTotal,
    int AvailableStock = 0,
    bool IsAvailable = true);

public record CartDto(Guid Id, decimal TotalAmount, int TotalQuantity, List<CartItemDto> Items, string? Notice = null);

internal static class CartMapping
{
    /// <summary>
    /// Đồng bộ giỏ với dữ liệu sản phẩm mới nhất (CN-06.5): cập nhật đơn giá hiển thị,
    /// tính tồn kho khả dụng (Stock − ReservedStock) và cờ IsAvailable cho từng dòng.
    /// Dòng ngừng bán (IsActive = false) hoặc hết hàng bị đánh dấu để FE chặn thanh toán dòng đó.
    /// </summary>
    public static CartDto ToDto(DAFL.Backend.Infrastructure.Data.Cart cart, string? notice = null)
    {
        var items = cart.Items.Select(ci =>
        {
            var product = ci.Product;
            var available = product != null ? Math.Max(0, product.Stock - product.ReservedStock) : 0;
            var isAvailable = product != null && product.IsActive && available > 0;
            var currentPrice = product?.Price ?? ci.UnitPrice;
            return new CartItemDto(
                ci.Id,
                ci.ProductId,
                product?.Name ?? "Sản phẩm",
                product?.ImageUrl ?? "",
                currentPrice,
                ci.Quantity,
                currentPrice * ci.Quantity,
                available,
                isAvailable);
        }).ToList();

        // Tổng tiền/số lượng chỉ tính các dòng còn mua được — dòng ngừng bán/hết hàng (IsAvailable = false)
        // vẫn hiển thị kèm cờ để FE chặn thanh toán dòng đó nhưng không cộng vào tổng (CN-06.5).
        return new CartDto(
            cart.Id,
            items.Where(i => i.IsAvailable).Sum(i => i.SubTotal),
            items.Where(i => i.IsAvailable).Sum(i => i.Quantity),
            items,
            notice);
    }

    public static async Task<DAFL.Backend.Infrastructure.Data.Cart> GetOrCreateCartAsync(AppDbContext context, Guid userId, CancellationToken ct)
    {
        var cart = await context.Carts
            .Include(c => c.Items)
            .ThenInclude(i => i.Product)
            .FirstOrDefaultAsync(c => c.UserId == userId, ct);

        if (cart == null)
        {
            cart = new DAFL.Backend.Infrastructure.Data.Cart
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            await context.Carts.AddAsync(cart, ct);
            await context.SaveChangesAsync(ct);
        }

        return cart;
    }
}

// 1. Get Cart (theo tài khoản đang đăng nhập)
public record GetCartQuery(Guid UserId) : IRequest<ApiResponse<CartDto>>;

public class GetCartQueryHandler : IRequestHandler<GetCartQuery, ApiResponse<CartDto>>
{
    private readonly AppDbContext _context;

    public GetCartQueryHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<CartDto>> Handle(GetCartQuery request, CancellationToken cancellationToken)
    {
        var cart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        return ApiResponse<CartDto>.Ok(CartMapping.ToDto(cart));
    }
}

// 2. Add Item to Cart — cộng dồn khi trùng sản phẩm; vượt tồn kho thì chỉ thêm tới mức tối đa (CN-06.1)
public record AddToCartCommand(Guid UserId, Guid ProductId, int Quantity) : IRequest<ApiResponse<CartDto>>;

public class AddToCartCommandHandler : IRequestHandler<AddToCartCommand, ApiResponse<CartDto>>
{
    private readonly AppDbContext _context;

    public AddToCartCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<CartDto>> Handle(AddToCartCommand request, CancellationToken cancellationToken)
    {
        var product = await _context.Products.FindAsync(new object[] { request.ProductId }, cancellationToken);
        if (product == null) return ApiResponse<CartDto>.Fail("Không tìm thấy sản phẩm.");
        if (!product.IsActive) return ApiResponse<CartDto>.Fail("Sản phẩm đã ngừng bán.");

        var available = Math.Max(0, product.Stock - product.ReservedStock);
        if (available <= 0) return ApiResponse<CartDto>.Fail("Sản phẩm đã hết hàng.");
        if (request.Quantity <= 0) return ApiResponse<CartDto>.Fail("Số lượng phải lớn hơn 0.");

        var cart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        var existingItem = cart.Items.FirstOrDefault(i => i.ProductId == product.Id);

        string? notice = null;
        var currentQty = existingItem?.Quantity ?? 0;
        var targetQty = currentQty + request.Quantity;
        if (targetQty > available)
        {
            targetQty = available;
            notice = $"Chỉ còn {available} sản phẩm.";
        }

        if (existingItem != null)
        {
            existingItem.Quantity = targetQty;
            existingItem.UnitPrice = product.Price;
        }
        else
        {
            // Phải Add qua DbSet: thêm thuần qua navigation collection khiến EF hiểu nhầm
            // dòng mới là entity đã tồn tại (Modified) → DbUpdateConcurrencyException khi lưu.
            var newItem = new CartItem
            {
                Id = Guid.NewGuid(),
                CartId = cart.Id,
                ProductId = product.Id,
                UnitPrice = product.Price,
                Quantity = targetQty,
                AddedAt = DateTime.UtcNow
            };
            cart.Items.Add(newItem);
            _context.CartItems.Add(newItem);
        }

        cart.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);

        // Nạp lại để DTO có dữ liệu sản phẩm đầy đủ
        var freshCart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        return ApiResponse<CartDto>.Ok(CartMapping.ToDto(freshCart, notice), notice ?? "Đã thêm vào giỏ hàng");
    }
}

// 3. Update Cart Item Quantity — vượt tồn kho thì đặt về tối đa + báo "Chỉ còn X sản phẩm" (CN-06.3); ≤ 0 thì xóa dòng
public record UpdateCartItemCommand(Guid UserId, Guid ItemId, int Quantity) : IRequest<ApiResponse<CartDto>>;

public class UpdateCartItemCommandHandler : IRequestHandler<UpdateCartItemCommand, ApiResponse<CartDto>>
{
    private readonly AppDbContext _context;

    public UpdateCartItemCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<CartDto>> Handle(UpdateCartItemCommand request, CancellationToken cancellationToken)
    {
        var cart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        var item = cart.Items.FirstOrDefault(i => i.Id == request.ItemId);
        if (item == null) return ApiResponse<CartDto>.Fail("Không tìm thấy sản phẩm trong giỏ hàng.");

        string? notice = null;
        if (request.Quantity <= 0)
        {
            _context.CartItems.Remove(item);
            cart.Items.Remove(item);
        }
        else
        {
            var product = item.Product;
            var available = product != null ? Math.Max(0, product.Stock - product.ReservedStock) : 0;
            var newQty = request.Quantity;
            if (newQty > available)
            {
                newQty = available;
                notice = $"Chỉ còn {available} sản phẩm.";
            }

            if (newQty <= 0)
            {
                _context.CartItems.Remove(item);
                cart.Items.Remove(item);
            }
            else
            {
                item.Quantity = newQty;
                if (product != null) item.UnitPrice = product.Price;
            }
        }

        cart.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        return ApiResponse<CartDto>.Ok(CartMapping.ToDto(cart, notice), notice ?? "Cập nhật giỏ hàng thành công.");
    }
}

// 4. Remove Item from Cart (idempotent)
public record RemoveCartItemCommand(Guid UserId, Guid ItemId) : IRequest<ApiResponse<CartDto>>;

public class RemoveCartItemCommandHandler : IRequestHandler<RemoveCartItemCommand, ApiResponse<CartDto>>
{
    private readonly AppDbContext _context;

    public RemoveCartItemCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<CartDto>> Handle(RemoveCartItemCommand request, CancellationToken cancellationToken)
    {
        var cart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        var item = cart.Items.FirstOrDefault(i => i.Id == request.ItemId);
        if (item != null)
        {
            _context.CartItems.Remove(item);
            cart.Items.Remove(item);
            cart.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync(cancellationToken);
        }

        return ApiResponse<CartDto>.Ok(CartMapping.ToDto(cart), "Đã xóa sản phẩm khỏi giỏ hàng.");
    }
}

// 5. Merge guest cart → account cart (CN-06.4): trùng thì cộng dồn, không vượt tồn kho
public record MergeCartItemDto(Guid ProductId, int Quantity);

public record MergeCartCommand(Guid UserId, List<MergeCartItemDto> Items) : IRequest<ApiResponse<CartDto>>;

public class MergeCartCommandHandler : IRequestHandler<MergeCartCommand, ApiResponse<CartDto>>
{
    private readonly AppDbContext _context;

    public MergeCartCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<CartDto>> Handle(MergeCartCommand request, CancellationToken cancellationToken)
    {
        var cart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        var notices = new List<string>();

        foreach (var guestItem in request.Items)
        {
            if (guestItem.Quantity <= 0) continue;

            var product = await _context.Products.FindAsync(new object[] { guestItem.ProductId }, cancellationToken);
            if (product == null || !product.IsActive) continue;

            var available = Math.Max(0, product.Stock - product.ReservedStock);
            if (available <= 0)
            {
                notices.Add($"Sản phẩm '{product.Name}' đã hết hàng nên không được gộp vào giỏ.");
                continue;
            }

            var existingItem = cart.Items.FirstOrDefault(i => i.ProductId == product.Id);
            var targetQty = (existingItem?.Quantity ?? 0) + guestItem.Quantity;
            if (targetQty > available)
            {
                targetQty = available;
                notices.Add($"Chỉ còn {available} sản phẩm '{product.Name}'.");
            }

            if (existingItem != null)
            {
                existingItem.Quantity = targetQty;
                existingItem.UnitPrice = product.Price;
            }
            else
            {
                var newItem = new CartItem
                {
                    Id = Guid.NewGuid(),
                    CartId = cart.Id,
                    ProductId = product.Id,
                    UnitPrice = product.Price,
                    Quantity = targetQty,
                    AddedAt = DateTime.UtcNow
                };
                cart.Items.Add(newItem);
                await _context.CartItems.AddAsync(newItem, cancellationToken);
            }
        }

        cart.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);

        var freshCart = await CartMapping.GetOrCreateCartAsync(_context, request.UserId, cancellationToken);
        var notice = notices.Count > 0 ? string.Join(" ", notices) : null;
        return ApiResponse<CartDto>.Ok(CartMapping.ToDto(freshCart, notice), "Đã gộp giỏ hàng.");
    }
}
