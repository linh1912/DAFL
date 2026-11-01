using DAFL.Backend.Features.Addresses;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Tests.Features.Addresses;

/// <summary>
/// Unit tests cho sổ địa chỉ CN-03.3: tối đa 5 địa chỉ, địa chỉ đầu tiên tự mặc định,
/// xóa mặc định → địa chỉ còn lại mới nhất thành mặc định, chỉ thao tác trên địa chỉ của chính mình.
/// </summary>
public class AddressTests : IDisposable
{
    private readonly AppDbContext _context = TestDbContextFactory.CreateWithSeedData();
    private readonly Guid _userId = TestConstants.TestUserId;

    public void Dispose() => _context.Dispose();

    private CreateAddressCommand CreateCmd(string detail = "Số 1 Đường Lớn", bool setDefault = false) => new(
        _userId, "Người Nhận", "0901234567",
        "01", "TP. Hồ Chí Minh", "001", "Quận 1", "00001", "Phường Bến Nghé",
        detail, null, setDefault);

    /// <summary>
    /// TC-ADDR-01: Thêm địa chỉ đầu tiên → tự động là mặc định.
    /// </summary>
    [Fact]
    public async Task Create_FirstAddress_BecomesDefault()
    {
        var handler = new CreateAddressCommandHandler(_context);

        var result = await handler.Handle(CreateCmd(), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.IsDefault.Should().BeTrue();
    }

    /// <summary>
    /// TC-ADDR-02 (CN-03 E2): Đã có 5 địa chỉ → thêm thứ 6 bị từ chối với thông điệp rõ ràng.
    /// </summary>
    [Fact]
    public async Task Create_SixthAddress_ShouldFail()
    {
        var handler = new CreateAddressCommandHandler(_context);
        for (var i = 0; i < 5; i++)
        {
            var r = await handler.Handle(CreateCmd($"Số {i + 1} Đường Lớn"), CancellationToken.None);
            r.Success.Should().BeTrue();
        }

        var sixth = await handler.Handle(CreateCmd("Số 6 Đường Lớn"), CancellationToken.None);

        sixth.Success.Should().BeFalse();
        sixth.Message.Should().Contain("tối đa 5 địa chỉ");
        (await _context.UserAddresses.CountAsync(a => a.UserId == _userId)).Should().Be(5);
    }

    /// <summary>
    /// TC-ADDR-03: Đặt mặc định thủ công → đúng một địa chỉ mặc định.
    /// </summary>
    [Fact]
    public async Task SetDefault_ShouldSwitchExclusively()
    {
        var create = new CreateAddressCommandHandler(_context);
        var first = await create.Handle(CreateCmd("Địa chỉ một"), CancellationToken.None);
        var second = await create.Handle(CreateCmd("Địa chỉ hai"), CancellationToken.None);

        var setDefault = new SetDefaultAddressCommandHandler(_context);
        var result = await setDefault.Handle(new SetDefaultAddressCommand(_userId, second.Data!.Id), CancellationToken.None);

        result.Success.Should().BeTrue();
        var defaults = await _context.UserAddresses.Where(a => a.UserId == _userId && a.IsDefault).ToListAsync();
        defaults.Should().ContainSingle().Which.Id.Should().Be(second.Data.Id);
        first.Data!.Id.Should().NotBe(second.Data.Id);
    }

    /// <summary>
    /// TC-ADDR-04: Xóa địa chỉ mặc định → địa chỉ còn lại MỚI NHẤT tự thành mặc định.
    /// </summary>
    [Fact]
    public async Task Delete_DefaultAddress_NewestRemainingBecomesDefault()
    {
        var create = new CreateAddressCommandHandler(_context);
        var first = await create.Handle(CreateCmd("Địa chỉ một"), CancellationToken.None);
        var second = await create.Handle(CreateCmd("Địa chỉ hai"), CancellationToken.None);
        var third = await create.Handle(CreateCmd("Địa chỉ ba"), CancellationToken.None);

        // Ép mốc thời gian phân biệt rõ ràng (tránh 3 địa chỉ cùng một tick đồng hồ)
        var entities = await _context.UserAddresses.ToListAsync();
        entities.Single(a => a.Id == second.Data!.Id).CreatedAt = DateTime.UtcNow.AddMinutes(1);
        entities.Single(a => a.Id == third.Data!.Id).CreatedAt = DateTime.UtcNow.AddMinutes(2);
        await _context.SaveChangesAsync();

        var delete = new DeleteAddressCommandHandler(_context);
        var result = await delete.Handle(new DeleteAddressCommand(_userId, first.Data!.Id), CancellationToken.None);

        result.Success.Should().BeTrue();
        var remaining = await _context.UserAddresses.Where(a => a.UserId == _userId).ToListAsync();
        remaining.Should().HaveCount(2);
        remaining.Single(a => a.IsDefault).Id.Should().Be(third.Data!.Id);
        second.Data!.Id.Should().NotBe(third.Data.Id);
    }

    /// <summary>
    /// TC-ADDR-05: Validate — thiếu phường/xã, SĐT sai định dạng, địa chỉ chi tiết quá ngắn đều bị chặn.
    /// </summary>
    [Fact]
    public async Task Create_InvalidData_ShouldFail()
    {
        var handler = new CreateAddressCommandHandler(_context);

        var missingWard = CreateCmd() with { WardCode = "" };
        (await handler.Handle(missingWard, CancellationToken.None)).Message.Should().Contain("phường/xã");

        var badPhone = CreateCmd() with { Phone = "123" };
        (await handler.Handle(badPhone, CancellationToken.None)).Message.Should().Be("Số điện thoại không hợp lệ");

        var shortDetail = CreateCmd("abc");
        (await handler.Handle(shortDetail, CancellationToken.None)).Message.Should().Contain("ít nhất 5 ký tự");
    }

    /// <summary>
    /// TC-ADDR-06: Không sửa/xóa được địa chỉ của người khác.
    /// </summary>
    [Fact]
    public async Task UpdateOrDelete_OthersAddress_ShouldFail()
    {
        var create = new CreateAddressCommandHandler(_context);
        var mine = await create.Handle(CreateCmd(), CancellationToken.None);
        var otherUser = Guid.NewGuid();

        var update = new UpdateAddressCommandHandler(_context);
        var updateResult = await update.Handle(new UpdateAddressCommand(
            otherUser, mine.Data!.Id, "Kẻ Lạ", "0901234567", "01", "TP. Hồ Chí Minh", "001", "Quận 1",
            "00001", "Phường Bến Nghé", "Địa chỉ bị sửa lén", null), CancellationToken.None);
        updateResult.Success.Should().BeFalse();

        var delete = new DeleteAddressCommandHandler(_context);
        var deleteResult = await delete.Handle(new DeleteAddressCommand(otherUser, mine.Data!.Id), CancellationToken.None);
        deleteResult.Success.Should().BeFalse();
        (await _context.UserAddresses.CountAsync()).Should().Be(1);
    }
}
