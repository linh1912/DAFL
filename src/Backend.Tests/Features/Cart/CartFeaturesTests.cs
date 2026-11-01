using DAFL.Backend.Features.Cart;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Tests.Features.Cart;

/// <summary>
/// Unit tests cho module Cart phía server theo CN-06: giỏ gắn với tài khoản (JWT userId),
/// số lượng bị chặn ở tồn kho khả dụng kèm thông báo "Chỉ còn X sản phẩm",
/// gộp giỏ khách khi đăng nhập (merge), đồng bộ giá/tồn kho + cờ isAvailable ở mỗi lần đọc.
/// </summary>
public class CartFeaturesTests : IDisposable
{
    private readonly AppDbContext _context;

    public CartFeaturesTests()
    {
        _context = TestDbContextFactory.CreateWithSeedData();
    }

    public void Dispose() => _context.Dispose();

    private async Task<CartItem> CreateCartWithItem(Guid userId, Guid productId, int quantity)
    {
        var cart = new DAFL.Backend.Infrastructure.Data.Cart
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context.Carts.Add(cart);
        var product = await _context.Products.FirstAsync(p => p.Id == productId);
        var item = new CartItem
        {
            Id = Guid.NewGuid(),
            CartId = cart.Id,
            ProductId = productId,
            UnitPrice = product.Price,
            Quantity = quantity,
            AddedAt = DateTime.UtcNow
        };
        _context.CartItems.Add(item);
        await _context.SaveChangesAsync();
        return item;
    }

    #region GetCart Tests

    /// <summary>
    /// TC-CART-01: Lấy giỏ hàng mới (chưa tồn tại) → Tạo giỏ hàng mới rỗng.
    /// </summary>
    [Fact]
    public async Task GetCart_WhenCartDoesNotExist_ShouldCreateNewEmptyCart()
    {
        var handler = new GetCartQueryHandler(_context);
        var query = new GetCartQuery(Guid.NewGuid());

        var result = await handler.Handle(query, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Items.Should().BeEmpty();
        result.Data.TotalAmount.Should().Be(0);
        result.Data.TotalQuantity.Should().Be(0);
    }

    /// <summary>
    /// TC-CART-02: Lấy giỏ hàng đã có sản phẩm → Trả về đúng số lượng và tổng tiền (giá đồng bộ mới nhất).
    /// </summary>
    [Fact]
    public async Task GetCart_WithExistingItems_ShouldReturnCorrectTotals()
    {
        var userId = Guid.NewGuid();
        await CreateCartWithItem(userId, TestConstants.TestProductId1, 2);
        var product = await _context.Products.FirstAsync(p => p.Id == TestConstants.TestProductId1);

        var handler = new GetCartQueryHandler(_context);
        var result = await handler.Handle(new GetCartQuery(userId), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.Items.Should().HaveCount(1);
        result.Data.TotalQuantity.Should().Be(2);
        result.Data.TotalAmount.Should().Be(product.Price * 2);
        result.Data.Items[0].IsAvailable.Should().BeTrue();
        result.Data.Items[0].AvailableStock.Should().Be(50);
    }

    /// <summary>
    /// TC-CART-02B (CN-06.5): Sản phẩm ngừng bán → dòng bị đánh dấu isAvailable = false và không tính vào tổng tiền.
    /// </summary>
    [Fact]
    public async Task GetCart_WhenProductDeactivated_ShouldMarkItemUnavailable()
    {
        var userId = Guid.NewGuid();
        await CreateCartWithItem(userId, TestConstants.TestProductId1, 1);
        var product = await _context.Products.FirstAsync(p => p.Id == TestConstants.TestProductId1);
        product.IsActive = false;
        await _context.SaveChangesAsync();

        var handler = new GetCartQueryHandler(_context);
        var result = await handler.Handle(new GetCartQuery(userId), CancellationToken.None);

        result.Data!.Items[0].IsAvailable.Should().BeFalse();
        result.Data.TotalAmount.Should().Be(0);
    }

    #endregion

    #region AddToCart Tests

    /// <summary>
    /// TC-CART-03: Thêm sản phẩm vào giỏ hàng (sản phẩm chưa có) → Thành công.
    /// </summary>
    [Fact]
    public async Task AddToCart_NewProduct_ShouldAddSuccessfully()
    {
        var handler = new AddToCartCommandHandler(_context);
        var command = new AddToCartCommand(TestConstants.TestUserId, TestConstants.TestProductId1, 1);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        var cart = await _context.Carts
            .Include(c => c.Items)
            .FirstOrDefaultAsync(c => c.UserId == TestConstants.TestUserId);
        cart.Should().NotBeNull();
        cart!.Items.Should().Contain(i => i.ProductId == TestConstants.TestProductId1);
    }

    /// <summary>
    /// TC-CART-04: Thêm sản phẩm đã có trong giỏ → Cộng dồn số lượng.
    /// </summary>
    [Fact]
    public async Task AddToCart_ExistingProduct_ShouldIncrementQuantity()
    {
        var handler = new AddToCartCommandHandler(_context);
        var command = new AddToCartCommand(TestConstants.TestUserId, TestConstants.TestProductId1, 1);

        await handler.Handle(command, CancellationToken.None);
        await handler.Handle(command with { Quantity = 2 }, CancellationToken.None);

        var cart = await _context.Carts
            .Include(c => c.Items)
            .FirstOrDefaultAsync(c => c.UserId == TestConstants.TestUserId);
        var item = cart!.Items.First(i => i.ProductId == TestConstants.TestProductId1);
        item.Quantity.Should().Be(3); // 1 + 2
    }

    /// <summary>
    /// TC-CART-06: Thêm sản phẩm không tồn tại → Trả về lỗi.
    /// </summary>
    [Fact]
    public async Task AddToCart_NonExistentProduct_ShouldReturnFail()
    {
        var handler = new AddToCartCommandHandler(_context);
        var command = new AddToCartCommand(TestConstants.TestUserId, Guid.NewGuid(), 1);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Không tìm thấy sản phẩm");
    }

    /// <summary>
    /// TC-CART-07 (CN-06.1): Thêm vượt tồn kho → KHÔNG lỗi: số lượng bị chặn ở mức tối đa
    /// và response kèm thông báo "Chỉ còn X sản phẩm".
    /// </summary>
    [Fact]
    public async Task AddToCart_ExceedingStock_ShouldClampToAvailableWithNotice()
    {
        var handler = new AddToCartCommandHandler(_context);
        var command = new AddToCartCommand(TestConstants.TestUserId, TestConstants.TestProductId1, 999);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        var item = result.Data!.Items.First(i => i.ProductId == TestConstants.TestProductId1);
        item.Quantity.Should().Be(50); // tồn kho khả dụng của product1 = 50
        result.Data.Notice.Should().Contain("Chỉ còn 50 sản phẩm");
    }

    #endregion

    #region MergeCart Tests (CN-06.4)

    /// <summary>
    /// TC-CART-13: Gộp giỏ khách vào giỏ tài khoản → cộng dồn, clamp ở tồn kho, bỏ qua sản phẩm không tồn tại.
    /// </summary>
    [Fact]
    public async Task MergeCart_ShouldAccumulateClampAndSkipUnknown()
    {
        var userId = Guid.NewGuid();
        await CreateCartWithItem(userId, TestConstants.TestProductId1, 48);

        var handler = new MergeCartCommandHandler(_context);
        var command = new MergeCartCommand(userId, new List<MergeCartItemDto>
        {
            new(TestConstants.TestProductId1, 10), // 48 + 10 = 58 → clamp 50
            new(TestConstants.TestProductId2, 3),
            new(Guid.NewGuid(), 5) // sản phẩm không tồn tại → bỏ qua
        });

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        var item1 = result.Data!.Items.First(i => i.ProductId == TestConstants.TestProductId1);
        item1.Quantity.Should().Be(50);
        var item2 = result.Data.Items.First(i => i.ProductId == TestConstants.TestProductId2);
        item2.Quantity.Should().Be(3);
        result.Data.Items.Should().HaveCount(2);
        result.Data.Notice.Should().Contain("Chỉ còn 50 sản phẩm");
    }

    #endregion

    #region UpdateCartItem Tests

    /// <summary>
    /// TC-CART-08: Cập nhật số lượng sản phẩm trong giỏ của chính mình → Thành công.
    /// </summary>
    [Fact]
    public async Task UpdateCartItem_WithValidQuantity_ShouldUpdateSuccessfully()
    {
        var userId = Guid.NewGuid();
        var cartItem = await CreateCartWithItem(userId, TestConstants.TestProductId1, 1);

        var handler = new UpdateCartItemCommandHandler(_context);
        var result = await handler.Handle(new UpdateCartItemCommand(userId, cartItem.Id, 5), CancellationToken.None);

        result.Success.Should().BeTrue();
        var updated = await _context.CartItems.FindAsync(cartItem.Id);
        updated!.Quantity.Should().Be(5);
    }

    /// <summary>
    /// TC-CART-09: Cập nhật số lượng = 0 → Xóa sản phẩm khỏi giỏ.
    /// </summary>
    [Fact]
    public async Task UpdateCartItem_WithZeroQuantity_ShouldRemoveItem()
    {
        var userId = Guid.NewGuid();
        var cartItem = await CreateCartWithItem(userId, TestConstants.TestProductId1, 1);

        var handler = new UpdateCartItemCommandHandler(_context);
        var result = await handler.Handle(new UpdateCartItemCommand(userId, cartItem.Id, 0), CancellationToken.None);

        result.Success.Should().BeTrue();
        var removed = await _context.CartItems.FindAsync(cartItem.Id);
        removed.Should().BeNull();
    }

    /// <summary>
    /// TC-CART-10: Cập nhật cart item không tồn tại (hoặc của người khác) → Trả về lỗi.
    /// </summary>
    [Fact]
    public async Task UpdateCartItem_NonExistentItem_ShouldReturnFail()
    {
        var handler = new UpdateCartItemCommandHandler(_context);
        var result = await handler.Handle(new UpdateCartItemCommand(Guid.NewGuid(), Guid.NewGuid(), 5), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Không tìm thấy sản phẩm trong giỏ hàng");
    }

    #endregion

    #region RemoveCartItem Tests

    /// <summary>
    /// TC-CART-11: Xóa sản phẩm khỏi giỏ → Thành công.
    /// </summary>
    [Fact]
    public async Task RemoveCartItem_WithValidId_ShouldRemoveSuccessfully()
    {
        var userId = Guid.NewGuid();
        var cartItem = await CreateCartWithItem(userId, TestConstants.TestProductId1, 1);

        var handler = new RemoveCartItemCommandHandler(_context);
        var result = await handler.Handle(new RemoveCartItemCommand(userId, cartItem.Id), CancellationToken.None);

        result.Success.Should().BeTrue();
        var removed = await _context.CartItems.FindAsync(cartItem.Id);
        removed.Should().BeNull();
    }

    /// <summary>
    /// TC-CART-12: Xóa sản phẩm không tồn tại → Vẫn trả về thành công (idempotent).
    /// </summary>
    [Fact]
    public async Task RemoveCartItem_NonExistentItem_ShouldReturnSuccess()
    {
        var handler = new RemoveCartItemCommandHandler(_context);
        var result = await handler.Handle(new RemoveCartItemCommand(Guid.NewGuid(), Guid.NewGuid()), CancellationToken.None);

        result.Success.Should().BeTrue();
    }

    #endregion
}
