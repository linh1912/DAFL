using DAFL.Backend.Common;
using DAFL.Backend.Features.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Email;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Moq;

namespace DAFL.Backend.Tests.Features.Auth;

/// <summary>Email sender giả cho test: chỉ ghi lại thư đã "gửi", không gửi thật.</summary>
public class FakeEmailSender : IEmailSender
{
    public List<(string To, string Subject, string Body)> Sent { get; } = new();

    public Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken = default)
    {
        Sent.Add((to, subject, body));
        return Task.CompletedTask;
    }
}

public static class OtpTestFactory
{
    /// <summary>
    /// Tạo OtpService cho test với environment = "Testing"
    /// → CanExposeDebugCode = true, handler trả debugCode để test đi tiếp happy path (cơ chế mock OTP).
    /// </summary>
    public static OtpService CreateOtpService(AppDbContext context, FakeEmailSender? emailSender = null)
    {
        var env = new Mock<IHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns("Testing");
        var config = new ConfigurationBuilder().Build();
        return new OtpService(context, emailSender ?? new FakeEmailSender(), config, env.Object);
    }
}

/// <summary>
/// Unit tests cho module Authentication.
/// Bao gồm: Đăng ký, Đăng nhập (Positive & Negative paths).
/// Tỷ lệ: 70% Positive (luồng thành công), 30% Negative (email trùng, sai mật khẩu).
/// </summary>
public class AuthCommandsTests : IDisposable
{
    private readonly AppDbContext _context;
    private readonly Mock<IKafkaProducer> _mockKafkaProducer;
    private readonly Mock<IHubContext<NotificationHub, INotificationClient>> _mockHubContext;
    private readonly Mock<INotificationClient> _mockClients;
    private readonly OtpService _otpService;

    public AuthCommandsTests()
    {
        _context = TestDbContextFactory.CreateWithSeedData();
        _otpService = OtpTestFactory.CreateOtpService(_context);
        _mockKafkaProducer = new Mock<IKafkaProducer>();
        _mockHubContext = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        _mockClients = new Mock<INotificationClient>();

        // Setup SignalR mock chain
        _mockHubContext.Setup(h => h.Clients.Group(It.IsAny<string>())).Returns(_mockClients.Object);
        _mockClients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
    }

    public void Dispose() => _context.Dispose();

    #region Register Tests - Positive Path

    /// <summary>
    /// TC-AUTH-01 (đã cập nhật theo nghiệp vụ v3): Đăng ký hợp lệ → Thành công nhưng
    /// tài khoản ở trạng thái CHỜ XÁC THỰC (RequiresVerification = true), chưa có session.
    /// Ở môi trường Testing, response kèm debugCode (mock OTP) để test đi tiếp bước xác thực.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldReturnSuccess()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("newuser@dafl.vn", "SecurePass@123", "Nguyen Van A", "0912345678", "456 New Street");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Should().NotBeNull();
        result.Success.Should().BeTrue();
        result.Message.Should().Contain("Đăng ký thành công");
        result.Data.Should().NotBeNull();
        result.Data!.Email.Should().Be("newuser@dafl.vn");
        result.Data.RequiresVerification.Should().BeTrue();
        result.Data.DebugCode.Should().NotBeNullOrEmpty(); // Testing env → mock OTP lộ mã
    }

    /// <summary>
    /// TC-AUTH-02: Đăng ký thành công → User được lưu vào database.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldPersistUserInDatabase()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("persist@dafl.vn", "Pass@123", "Tran B", null, null);

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        var savedUser = await _context.Users.FirstOrDefaultAsync(u => u.Email == "persist@dafl.vn");
        savedUser.Should().NotBeNull();
        savedUser!.FullName.Should().Be("Tran B");
    }

    /// <summary>
    /// TC-AUTH-03 (đã cập nhật theo nghiệp vụ v3): Đăng ký thành công → KHÔNG tạo session ngay;
    /// user ở trạng thái EmailVerified = false và có 1 mã OTP VerifyEmail đang chờ.
    /// Session chỉ được tạo sau khi xác thực email thành công.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldNotCreateSessionUntilEmailVerified()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("session@dafl.vn", "Pass@123", "Session User", null, null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeTrue();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == "session@dafl.vn");
        user.Should().NotBeNull();
        user!.EmailVerified.Should().BeFalse();
        var session = await _context.UserSessions.FirstOrDefaultAsync(s => s.UserId == user.Id);
        session.Should().BeNull();
        var otp = await _context.OtpCodes.FirstOrDefaultAsync(o => o.Email == "session@dafl.vn" && o.Purpose == OtpPurposes.VerifyEmail);
        otp.Should().NotBeNull();
        otp!.Used.Should().BeFalse();
    }

    /// <summary>
    /// TC-AUTH-04: Đăng ký thành công → Notification chào mừng được tạo trong DB.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldCreateWelcomeNotification()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("welcome@dafl.vn", "Pass@123", "Welcome User", null, null);

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == "welcome@dafl.vn");
        var notification = await _context.Notifications.FirstOrDefaultAsync(n => n.UserId == user!.Id);
        notification.Should().NotBeNull();
        notification!.Title.Should().Contain("Chào mừng");
        notification.Type.Should().Be("Promotion");
    }

    /// <summary>
    /// TC-AUTH-05: Đăng ký thành công → Kafka event được publish.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldPublishKafkaEvent()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("kafka@dafl.vn", "Pass@123", "Kafka User", null, null);

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        _mockKafkaProducer.Verify(k => k.PublishAsync(
            "notification-events",
            "kafka@dafl.vn",
            It.IsAny<NotificationEvent>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>
    /// TC-AUTH-06: Đăng ký với email viết HOA → Email được normalize về lowercase.
    /// </summary>
    [Fact]
    public async Task Register_WithUppercaseEmail_ShouldNormalizeToLowercase()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("UPPERCASE@DAFL.VN", "Pass@123", "Upper User", null, null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeTrue();
        result.Data!.Email.Should().Be("uppercase@dafl.vn");
    }

    #endregion

    #region Register Tests - Negative Path

    /// <summary>
    /// TC-AUTH-07: Đăng ký với email đã tồn tại → Trả về lỗi "Email đã được sử dụng".
    /// </summary>
    [Fact]
    public async Task Register_WithDuplicateEmail_ShouldReturnFail()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("test@dafl.vn", "Pass@123", "Duplicate User", null, null);
        // Email "test@dafl.vn" đã tồn tại trong seed data

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Email này đã được sử dụng");
        result.Data.Should().BeNull();
    }

    /// <summary>
    /// TC-AUTH-07A: Đăng ký với mật khẩu ngắn hơn 8 ký tự → Thất bại.
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordShorterThan8Chars_ShouldReturnFail()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("shortpw@dafl.vn", "Pass@1", "Short Pass User", null, null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("8 ký tự");
    }

    /// <summary>
    /// TC-AUTH-07B: Đăng ký với mật khẩu không có ký tự viết hoa → Thất bại.
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordWithoutUppercase_ShouldReturnFail()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("noupper@dafl.vn", "pass@123", "No Upper User", null, null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("chữ hoa");
    }

    /// <summary>
    /// TC-AUTH-07C: Đăng ký với mật khẩu không có ký tự đặc biệt → Thất bại.
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordWithoutSpecialChar_ShouldReturnFail()
    {
        // Arrange
        var handler = new RegisterCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);
        var command = new RegisterCommand("nospecial@dafl.vn", "Password123", "No Special User", null, null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("đặc biệt");
    }

    #endregion

    #region Login Tests - Positive Path

    /// <summary>
    /// TC-AUTH-08: Đăng nhập với thông tin chính xác → Thành công, trả về session.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ShouldReturnSuccess()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var command = new LoginCommand("test@dafl.vn", "Test@123");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.SessionId.Should().NotBeNullOrEmpty();
        result.Data.Email.Should().Be("test@dafl.vn");
    }

    /// <summary>
    /// TC-AUTH-09: Đăng nhập thành công → Session mới được tạo trong database.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ShouldCreateNewSession()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var command = new LoginCommand("test@dafl.vn", "Test@123");

        var sessionCountBefore = await _context.UserSessions.CountAsync();

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        var sessionCountAfter = await _context.UserSessions.CountAsync();
        sessionCountAfter.Should().Be(sessionCountBefore + 1);
    }

    /// <summary>
    /// TC-AUTH-10: Đăng nhập thành công → SignalR notification được gửi.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ShouldSendSignalRNotification()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var command = new LoginCommand("test@dafl.vn", "Test@123");

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        _mockClients.Verify(c => c.ReceiveNotification(It.IsAny<object>()), Times.Once);
        // Thông báo đăng nhập chỉ gửi cho nhóm của chính người dùng, không broadcast cho mọi client
        _mockHubContext.Verify(h => h.Clients.Group(NotificationGroups.ForUser(TestConstants.TestUserId)), Times.Once);
        _mockHubContext.Verify(h => h.Clients.All, Times.Never);
    }

    #endregion

    #region Login Tests - Negative Path

    /// <summary>
    /// TC-AUTH-11: Đăng nhập với mật khẩu sai → Trả về lỗi.
    /// </summary>
    [Fact]
    public async Task Login_WithWrongPassword_ShouldReturnFail()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var command = new LoginCommand("test@dafl.vn", "WrongPassword!");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Email hoặc mật khẩu không chính xác");
    }

    /// <summary>
    /// TC-AUTH-12: Đăng nhập với email không tồn tại → Trả về lỗi.
    /// </summary>
    [Fact]
    public async Task Login_WithNonExistentEmail_ShouldReturnFail()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var command = new LoginCommand("nonexistent@dafl.vn", "Pass@123");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Email hoặc mật khẩu không chính xác");
    }

    /// <summary>
    /// TC-AUTH-13: Đăng nhập sai → KHÔNG tạo session mới.
    /// </summary>
    [Fact]
    public async Task Login_WithWrongPassword_ShouldNotCreateSession()
    {
        // Arrange
        var handler = new LoginCommandHandler(_context, _mockKafkaProducer.Object, _mockHubContext.Object);
        var sessionCountBefore = await _context.UserSessions.CountAsync();
        var command = new LoginCommand("test@dafl.vn", "WrongPass!");

        // Act
        await handler.Handle(command, CancellationToken.None);

        // Assert
        var sessionCountAfter = await _context.UserSessions.CountAsync();
        sessionCountAfter.Should().Be(sessionCountBefore);
    }

    #endregion
}
