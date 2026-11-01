using DAFL.Backend.Features.Auth;
using DAFL.Backend.Infrastructure.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Moq;

namespace DAFL.Backend.Tests.Features.Auth;

/// <summary>
/// Unit tests cho module Authentication theo đặc tả CN-01/CN-02 (bản CN):
/// đăng ký không còn OTP — tài khoản dùng ngay; đăng nhập trả JWT hạn 1 giờ;
/// KHÔNG còn khóa tài khoản khi sai mật khẩu nhiều lần; policy mật khẩu giữ nguyên bản nghiêm ngặt
/// (≥ 8 ký tự + chữ hoa + chữ số + ký tự đặc biệt — ghi đè O2 của Daniel).
/// </summary>
public class AuthCommandsTests : IDisposable
{
    private readonly AppDbContext _context;
    private readonly Mock<IKafkaProducer> _mockKafkaProducer;
    private readonly Mock<IHubContext<NotificationHub, INotificationClient>> _mockHubContext;
    private readonly Mock<INotificationClient> _mockClients;
    private readonly IJwtService _jwtService;

    public AuthCommandsTests()
    {
        _context = TestDbContextFactory.CreateWithSeedData();
        _jwtService = CreateJwtService();
        _mockKafkaProducer = new Mock<IKafkaProducer>();
        _mockHubContext = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        _mockClients = new Mock<INotificationClient>();

        // Setup SignalR mock chain
        _mockHubContext.Setup(h => h.Clients.Group(It.IsAny<string>())).Returns(_mockClients.Object);
        _mockClients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
    }

    public static IJwtService CreateJwtService(string secret = "test-secret-key-for-jwt-unit-tests-0123456789")
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:Secret"] = secret })
            .Build();
        return new JwtService(config, Microsoft.Extensions.Logging.Abstractions.NullLogger<JwtService>.Instance);
    }

    public void Dispose() => _context.Dispose();

    private RegisterCommandHandler CreateRegisterHandler() =>
        new(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _jwtService);

    private LoginCommandHandler CreateLoginHandler() =>
        new(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _jwtService);

    #region Register Tests - Positive Path

    /// <summary>
    /// TC-AUTH-01 (CN-01): Đăng ký hợp lệ → thành công, trả JWT ngay (không còn bước xác thực email),
    /// tài khoản dùng ngay (EmailVerified = true vì CN không có cơ chế OTP).
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldReturnSuccessWithJwt()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("newuser@dafl.vn", "SecurePass@123", "Nguyen Van A", "0912345678", "456 New Street");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Should().NotBeNull();
        result.Success.Should().BeTrue();
        result.Message.Should().Contain("Đăng ký thành công");
        result.Data.Should().NotBeNull();
        result.Data!.User.Email.Should().Be("newuser@dafl.vn");
        result.Data.Token.Should().NotBeNullOrEmpty();
        _jwtService.ValidateToken(result.Data.Token).Should().Be(result.Data.User.Id);

        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == "newuser@dafl.vn");
        user.Should().NotBeNull();
        user!.EmailVerified.Should().BeTrue();
    }

    /// <summary>
    /// TC-AUTH-02: Đăng ký thành công → User được lưu vào database.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldPersistUserInDatabase()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("persist@dafl.vn", "Pass@123", "Tran B", "0987654321", "123 Đường Kiểm Thử, Hà Nội");

        await handler.Handle(command, CancellationToken.None);

        var savedUser = await _context.Users.FirstOrDefaultAsync(u => u.Email == "persist@dafl.vn");
        savedUser.Should().NotBeNull();
        savedUser!.FullName.Should().Be("Tran B");
    }

    /// <summary>
    /// TC-AUTH-04: Đăng ký thành công → Notification chào mừng được tạo trong DB.
    /// </summary>
    [Fact]
    public async Task Register_WithValidData_ShouldCreateWelcomeNotification()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("welcome@dafl.vn", "Pass@123", "Welcome User", "0901111111", "123 Đường Kiểm Thử, Hà Nội");

        await handler.Handle(command, CancellationToken.None);

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
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("kafka@dafl.vn", "Pass@123", "Kafka User", "0902222222", "123 Đường Kiểm Thử, Hà Nội");

        await handler.Handle(command, CancellationToken.None);

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
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("UPPERCASE@DAFL.VN", "Pass@123", "Upper User", "0903333333", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.User.Email.Should().Be("uppercase@dafl.vn");
    }

    /// <summary>
    /// TC-AUTH-06B (CN-01): Họ tên CÓ DẤU tiếng Việt hợp lệ ("Họ tên có dấu được phép").
    /// </summary>
    [Fact]
    public async Task Register_WithVietnameseAccentedName_ShouldSucceed()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("codau@dafl.vn", "Pass@123", "Nguyễn Văn Ánh", "0904444444", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
    }

    #endregion

    #region Register Tests - Negative Path

    /// <summary>
    /// TC-AUTH-07 (CN-01 E1): Email trùng → "Email đã được sử dụng".
    /// </summary>
    [Fact]
    public async Task Register_WithDuplicateEmail_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("test@dafl.vn", "Pass@123", "Duplicate User", "0905555555", "123 Đường Kiểm Thử, Hà Nội");
        // Email "test@dafl.vn" đã tồn tại trong seed data

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Email đã được sử dụng");
        result.Data.Should().BeNull();
    }

    /// <summary>
    /// TC-AUTH-07I (CN-01 E2): SĐT trùng với tài khoản khác → "Số điện thoại đã được sử dụng".
    /// </summary>
    [Fact]
    public async Task Register_WithDuplicatePhone_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        // SĐT 0901234567 thuộc về user seed test@dafl.vn
        var command = new RegisterCommand("newphone@dafl.vn", "Pass@123", "Phone Dup User", "0901234567", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Số điện thoại đã được sử dụng");
    }

    /// <summary>
    /// TC-AUTH-07J (CN-01): SĐT là BẮT BUỘC — để trống → "Số điện thoại không hợp lệ".
    /// </summary>
    [Fact]
    public async Task Register_WithoutPhone_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("nophone@dafl.vn", "Pass@123", "No Phone User", null, "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Số điện thoại không hợp lệ");
    }

    /// <summary>
    /// TC-AUTH-07K (CN-01): Họ tên ngoài khoảng 2–50 ký tự → "Họ tên không hợp lệ".
    /// </summary>
    [Fact]
    public async Task Register_WithTooShortFullName_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("shortname@dafl.vn", "Pass@123", " A ", "0906666666", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Họ tên không hợp lệ");
    }

    /// <summary>
    /// TC-AUTH-07L (CN-01): Email sai định dạng → "Email không hợp lệ".
    /// </summary>
    [Fact]
    public async Task Register_WithInvalidEmailFormat_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("khong-phai-email", "Pass@123", "Bad Email User", "0907777777", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Email không hợp lệ");
    }

    /// <summary>
    /// TC-AUTH-07A: Mật khẩu ngắn hơn 8 ký tự → Thất bại (policy nghiêm ngặt giữ nguyên theo quyết định của Daniel).
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordShorterThan8Chars_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("shortpw@dafl.vn", "Pass@1", "Short Pass User", "0908888888", null);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("8 ký tự");
    }

    /// <summary>
    /// TC-AUTH-07B: Mật khẩu không có chữ hoa → Thất bại (policy nghiêm ngặt, KHÔNG dùng rule nhẹ của CN).
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordWithoutUppercase_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("noupper@dafl.vn", "pass@123", "No Upper User", "0909999999", null);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("chữ hoa");
    }

    /// <summary>
    /// TC-AUTH-07C: Mật khẩu không có ký tự đặc biệt → Thất bại.
    /// </summary>
    [Fact]
    public async Task Register_WithPasswordWithoutSpecialChar_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("nospecial@dafl.vn", "Password123", "No Special User", "0911111111", null);

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("đặc biệt");
    }

    /// <summary>
    /// TC-AUTH-07F: SĐT sai định dạng VN (không bắt đầu bằng 0) → "Số điện thoại không hợp lệ".
    /// </summary>
    [Fact]
    public async Task Register_WithInvalidVietnamesePhone_ShouldReturnFail()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("badphone@dafl.vn", "Pass@123", "Bad Phone User", "1234567890", "123 Đường Kiểm Thử, Hà Nội");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Số điện thoại không hợp lệ");
    }

    /// <summary>
    /// TC-AUTH-07H: Khoảng trắng thừa ở đầu/cuối các trường → trim trước khi lưu (+ email lowercase).
    /// </summary>
    [Fact]
    public async Task Register_WithWhitespacePaddedFields_ShouldTrimBeforeSaving()
    {
        var handler = CreateRegisterHandler();
        var command = new RegisterCommand("  Padded@DAFL.vn  ", "Pass@123", "  Padded User  ", " 0912345678 ", "  99 Đường Trim, TP.HCM  ");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.User.Email.Should().Be("padded@dafl.vn");
        var savedUser = await _context.Users.FirstOrDefaultAsync(u => u.Email == "padded@dafl.vn");
        savedUser.Should().NotBeNull();
        savedUser!.FullName.Should().Be("Padded User");
        savedUser.PhoneNumber.Should().Be("0912345678");
        savedUser.Address.Should().Be("99 Đường Trim, TP.HCM");
    }

    #endregion

    #region Login Tests

    /// <summary>
    /// TC-AUTH-08 (CN-02): Đăng nhập đúng → trả { token, user }; token là JWT hạn 1 giờ,
    /// validate được về đúng userId (cơ chế của /api/auth/me).
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ShouldReturnJwt()
    {
        var handler = CreateLoginHandler();
        var command = new LoginCommand("test@dafl.vn", "Test@123");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Token.Should().NotBeNullOrEmpty();
        result.Data.User.Email.Should().Be("test@dafl.vn");
        result.Data.User.HasPassword.Should().BeTrue();
        result.Data.ExpiresAt.Should().BeCloseTo(DateTime.UtcNow.AddHours(1), TimeSpan.FromMinutes(2));
        _jwtService.ValidateToken(result.Data.Token).Should().Be(TestConstants.TestUserId);
    }

    /// <summary>
    /// TC-AUTH-10: Đăng nhập thành công → SignalR notification được gửi cho nhóm của chính người dùng.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ShouldSendSignalRNotification()
    {
        var handler = CreateLoginHandler();
        var command = new LoginCommand("test@dafl.vn", "Test@123");

        await handler.Handle(command, CancellationToken.None);

        _mockClients.Verify(c => c.ReceiveNotification(It.IsAny<object>()), Times.Once);
        _mockHubContext.Verify(h => h.Clients.Group(NotificationGroups.ForUser(TestConstants.TestUserId)), Times.Once);
        _mockHubContext.Verify(h => h.Clients.All, Times.Never);
    }

    /// <summary>
    /// TC-AUTH-11 (CN-02 E1): Sai mật khẩu → "Email hoặc mật khẩu không đúng" (không lộ email có tồn tại hay không).
    /// </summary>
    [Fact]
    public async Task Login_WithWrongPassword_ShouldReturnFail()
    {
        var handler = CreateLoginHandler();
        var command = new LoginCommand("test@dafl.vn", "WrongPassword!");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Email hoặc mật khẩu không đúng");
    }

    /// <summary>
    /// TC-AUTH-12 (CN-02 E1): Email không tồn tại → cùng một thông báo chung.
    /// </summary>
    [Fact]
    public async Task Login_WithNonExistentEmail_ShouldReturnFail()
    {
        var handler = CreateLoginHandler();
        var command = new LoginCommand("nonexistent@dafl.vn", "Pass@123");

        var result = await handler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Email hoặc mật khẩu không đúng");
    }

    /// <summary>
    /// TC-AUTH-13 (CN-02): CN KHÔNG có khóa tài khoản — sai mật khẩu 10 lần liên tiếp vẫn đăng nhập đúng được ngay sau đó.
    /// </summary>
    [Fact]
    public async Task Login_AfterManyFailedAttempts_ShouldStillSucceed_NoLockoutInCn()
    {
        var handler = CreateLoginHandler();

        for (var i = 0; i < 10; i++)
        {
            var fail = await handler.Handle(new LoginCommand("test@dafl.vn", "WrongPass!1"), CancellationToken.None);
            fail.Success.Should().BeFalse();
        }

        var result = await handler.Handle(new LoginCommand("test@dafl.vn", "Test@123"), CancellationToken.None);
        result.Success.Should().BeTrue();
    }

    #endregion
}
