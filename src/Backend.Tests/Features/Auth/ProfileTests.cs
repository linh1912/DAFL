using DAFL.Backend.Features.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace DAFL.Backend.Tests.Features.Auth;

/// <summary>
/// Unit tests cho CN-03.1 (cập nhật hồ sơ) và đổi mật khẩu (mật khẩu mới theo policy nghiêm ngặt hiện hành).
/// </summary>
public class ProfileTests : IDisposable
{
    private readonly AppDbContext _context = TestDbContextFactory.CreateWithSeedData();

    public void Dispose() => _context.Dispose();

    /// <summary>
    /// TC-PRO-01: Cập nhật họ tên + SĐT hợp lệ → thành công, dữ liệu thay đổi, email giữ nguyên.
    /// </summary>
    [Fact]
    public async Task UpdateProfile_ValidData_ShouldSucceed()
    {
        var handler = new UpdateProfileCommandHandler(_context);

        var result = await handler.Handle(
            new UpdateProfileCommand(TestConstants.TestUserId, "Tên Mới", "0988111222", null), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Message.Should().Be("Cập nhật thành công");
        var user = await _context.Users.SingleAsync(u => u.Id == TestConstants.TestUserId);
        user.FullName.Should().Be("Tên Mới");
        user.PhoneNumber.Should().Be("0988111222");
        user.Email.Should().Be("test@dafl.vn");
    }

    /// <summary>
    /// TC-PRO-02 (CN-03 E2): SĐT trùng tài khoản khác → "Số điện thoại đã được sử dụng".
    /// </summary>
    [Fact]
    public async Task UpdateProfile_WithPhoneOfAnotherUser_ShouldFail()
    {
        var other = new User
        {
            Id = Guid.NewGuid(),
            Email = "other@dafl.vn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Pass@123"),
            FullName = "Other User",
            PhoneNumber = "0977111222",
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            EmailVerified = true
        };
        _context.Users.Add(other);
        await _context.SaveChangesAsync();

        var handler = new UpdateProfileCommandHandler(_context);
        var result = await handler.Handle(
            new UpdateProfileCommand(TestConstants.TestUserId, null, "0977111222", null), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Số điện thoại đã được sử dụng");
    }

    /// <summary>
    /// TC-PRO-03: Đổi mật khẩu — sai mật khẩu hiện tại → "Mật khẩu hiện tại không đúng";
    /// mật khẩu mới trùng mật khẩu cũ → lỗi riêng; mật khẩu mới yếu → lỗi policy;
    /// hợp lệ → đăng nhập bằng mật khẩu mới được.
    /// </summary>
    [Fact]
    public async Task ChangePassword_FullFlow()
    {
        var handler = new ChangePasswordCommandHandler(_context);

        var wrongCurrent = await handler.Handle(
            new ChangePasswordCommand(TestConstants.TestUserId, "SaiMatKhau@1", "NewPass@123", "NewPass@123"), CancellationToken.None);
        wrongCurrent.Success.Should().BeFalse();
        wrongCurrent.Message.Should().Be("Mật khẩu hiện tại không đúng");

        var sameAsOld = await handler.Handle(
            new ChangePasswordCommand(TestConstants.TestUserId, "Test@123", "Test@123", "Test@123"), CancellationToken.None);
        sameAsOld.Success.Should().BeFalse();
        sameAsOld.Message.Should().Contain("không được trùng với mật khẩu cũ");

        var weak = await handler.Handle(
            new ChangePasswordCommand(TestConstants.TestUserId, "Test@123", "password123", "password123"), CancellationToken.None);
        weak.Success.Should().BeFalse();
        weak.Message.Should().Contain("chữ hoa");

        var ok = await handler.Handle(
            new ChangePasswordCommand(TestConstants.TestUserId, "Test@123", "NewPass@123", "NewPass@123"), CancellationToken.None);
        ok.Success.Should().BeTrue();

        var clients = new Mock<INotificationClient>();
        clients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
        var hub = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        hub.Setup(h => h.Clients.Group(It.IsAny<string>())).Returns(clients.Object);
        var loginHandler = new LoginCommandHandler(_context, new Mock<IKafkaProducer>().Object, hub.Object, AuthCommandsTests.CreateJwtService());
        var login = await loginHandler.Handle(new LoginCommand("test@dafl.vn", "NewPass@123"), CancellationToken.None);
        login.Success.Should().BeTrue();
    }
}
