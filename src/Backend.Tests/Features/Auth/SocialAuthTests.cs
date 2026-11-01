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
using Microsoft.Extensions.Hosting;
using Moq;

namespace DAFL.Backend.Tests.Features.Auth;

/// <summary>
/// Unit tests cho Social login (O3 — thiết kế v4, quy tắc liên kết L1–L5) + đặt mật khẩu cho tài khoản social.
/// Việc verify token với Google/Facebook nằm ở endpoint (IExternalAuthVerifier); handler nhận profile đã xác thực.
/// Mock login chỉ bật ở Development/Testing, Production tắt cứng; thành công đều cấp JWT 1 giờ (CN-02).
/// </summary>
public class SocialAuthTests : IDisposable
{
    private readonly AppDbContext _context = TestDbContextFactory.CreateWithSeedData();
    private readonly IJwtService _jwtService = AuthCommandsTests.CreateJwtService();

    public void Dispose() => _context.Dispose();

    private static IHostEnvironment CreateEnv(string environmentName)
    {
        var env = new Mock<IHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns(environmentName);
        return env.Object;
    }

    private static IConfiguration CreateConfig(Dictionary<string, string?>? values = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(values ?? new Dictionary<string, string?>()).Build();

    private MockSocialLoginCommandHandler CreateMockHandler(string env = "Testing") =>
        new(_context, CreateEnv(env), CreateConfig(), _jwtService);

    private Mock<IHubContext<NotificationHub, INotificationClient>> CreateHub()
    {
        var clients = new Mock<INotificationClient>();
        clients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
        var hub = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        hub.Setup(h => h.Clients.Group(It.IsAny<string>())).Returns(clients.Object);
        hub.Setup(h => h.Clients.All).Returns(clients.Object);
        return hub;
    }

    /// <summary>
    /// TC-SOC-01 (L3): Mock Google lần đầu → tạo tài khoản mới (chưa có mật khẩu), cấp JWT,
    /// DTO có hasPassword = false + authProvider = "google" (đúng contract FE cần).
    /// </summary>
    [Fact]
    public async Task MockGoogle_FirstLogin_CreatesUserWithoutPassword()
    {
        var handler = CreateMockHandler();

        var result = await handler.Handle(new MockSocialLoginCommand("google"), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.User.Email.Should().Be("google.test@dafl.vn");
        result.Data.User.HasPassword.Should().BeFalse();
        result.Data.User.AuthProvider.Should().Be("google");
        result.Data.Token.Should().NotBeNullOrEmpty();
        _jwtService.ValidateToken(result.Data.Token).Should().Be(result.Data.User.Id);

        var identity = await _context.UserExternalIdentities.SingleAsync();
        identity.Provider.Should().Be("google");
        identity.ProviderUserId.Should().Be("mock-google-001");
    }

    /// <summary>
    /// TC-SOC-02 (L1): Mock Google lần hai → đăng nhập đúng tài khoản cũ, không tạo user trùng.
    /// </summary>
    [Fact]
    public async Task MockGoogle_SecondLogin_ReturnsSameUser()
    {
        var handler = CreateMockHandler();

        var first = await handler.Handle(new MockSocialLoginCommand("google"), CancellationToken.None);
        var userCount = await _context.Users.CountAsync();
        var second = await handler.Handle(new MockSocialLoginCommand("google"), CancellationToken.None);

        second.Data!.User.Id.Should().Be(first.Data!.User.Id);
        (await _context.Users.CountAsync()).Should().Be(userCount);
    }

    /// <summary>
    /// TC-SOC-03 (L2): Đã có tài khoản mật khẩu với email facebook.test@dafl.vn →
    /// mock Facebook liên kết vào đúng tài khoản đó (không tạo user mới), mật khẩu vẫn dùng được.
    /// </summary>
    [Fact]
    public async Task MockFacebook_WithExistingPasswordAccount_LinksIdentity()
    {
        _context.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Email = "facebook.test@dafl.vn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Pass@123"),
            FullName = "FB Existing",
            PhoneNumber = "0912222222",
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            EmailVerified = true
        });
        await _context.SaveChangesAsync();
        var userCount = await _context.Users.CountAsync();

        var handler = CreateMockHandler();
        var result = await handler.Handle(new MockSocialLoginCommand("facebook"), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Data!.User.HasPassword.Should().BeTrue();
        result.Data.User.AuthProvider.Should().Be("facebook");
        (await _context.Users.CountAsync()).Should().Be(userCount);
        (await _context.UserExternalIdentities.CountAsync()).Should().Be(1);
    }

    /// <summary>
    /// TC-SOC-04 (L3 + L4 + L2-chặn): Social login với profile đã xác thực:
    /// email mới → tạo tài khoản; profile không có email → lỗi rõ ràng;
    /// email trùng nhưng nhà cung cấp CHƯA xác thực email → không tự liên kết.
    /// </summary>
    [Fact]
    public async Task SocialLogin_ProfileRules()
    {
        var handler = new SocialLoginCommandHandler(_context, _jwtService);

        var ok = await handler.Handle(new SocialLoginCommand(
            new ExternalProfile("google", "g-123", "real.user@gmail.com", true, "Real User", null)), CancellationToken.None);
        ok.Success.Should().BeTrue();
        ok.Data!.User.Email.Should().Be("real.user@gmail.com");

        var noEmail = await handler.Handle(new SocialLoginCommand(
            new ExternalProfile("facebook", "fb-999", null, false, "No Mail", null)), CancellationToken.None);
        noEmail.Success.Should().BeFalse();
        noEmail.Message.Should().Contain("không cung cấp địa chỉ email");

        var unverifiedClash = await handler.Handle(new SocialLoginCommand(
            new ExternalProfile("google", "g-777", "test@dafl.vn", false, "Clash", null)), CancellationToken.None);
        unverifiedClash.Success.Should().BeFalse();
        unverifiedClash.Message.Should().Contain("Không thể liên kết");
    }

    /// <summary>
    /// TC-SOC-05: Mock login bị chặn cứng ở Production.
    /// </summary>
    [Fact]
    public async Task MockLogin_InProduction_ShouldFail()
    {
        var handler = CreateMockHandler("Production");

        var result = await handler.Handle(new MockSocialLoginCommand("google"), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("chỉ khả dụng ở môi trường kiểm thử");
    }

    /// <summary>
    /// TC-SOC-06: Tài khoản social đặt mật khẩu (policy nghiêm ngặt) → sau đó đăng nhập bằng mật khẩu được.
    /// </summary>
    [Fact]
    public async Task SetPassword_ForSocialAccount_ThenPasswordLoginWorks()
    {
        var mock = await CreateMockHandler().Handle(new MockSocialLoginCommand("google"), CancellationToken.None);
        var userId = mock.Data!.User.Id;

        var setPassword = new SetPasswordCommandHandler(_context);
        var setResult = await setPassword.Handle(new SetPasswordCommand(userId, "NewPass@123"), CancellationToken.None);
        setResult.Success.Should().BeTrue();

        var loginHandler = new LoginCommandHandler(_context, new Mock<IKafkaProducer>().Object, CreateHub().Object, _jwtService);
        var login = await loginHandler.Handle(new LoginCommand("google.test@dafl.vn", "NewPass@123"), CancellationToken.None);
        login.Success.Should().BeTrue();
        login.Data!.User.HasPassword.Should().BeTrue();
    }

    /// <summary>
    /// TC-SOC-07: Tài khoản ĐÃ có mật khẩu → set-password bị từ chối; mật khẩu yếu → bị policy chặn.
    /// </summary>
    [Fact]
    public async Task SetPassword_WhenPasswordExistsOrWeak_ShouldFail()
    {
        var handler = new SetPasswordCommandHandler(_context);

        var existing = await handler.Handle(new SetPasswordCommand(TestConstants.TestUserId, "NewPass@123"), CancellationToken.None);
        existing.Success.Should().BeFalse();
        existing.Message.Should().Contain("đã có mật khẩu");

        var mock = await CreateMockHandler().Handle(new MockSocialLoginCommand("facebook"), CancellationToken.None);
        var weak = await handler.Handle(new SetPasswordCommand(mock.Data!.User.Id, "password123"), CancellationToken.None);
        weak.Success.Should().BeFalse();
        weak.Message.Should().Contain("chữ hoa");
    }

    /// <summary>
    /// TC-SOC-08: Config cho FE — provider tắt khi thiếu ClientId/AppId/Secret; mock chỉ bật ở Dev/Testing.
    /// </summary>
    [Fact]
    public void SocialConfig_ReflectsSettings()
    {
        var config = CreateConfig(new Dictionary<string, string?>
        {
            ["Social:GoogleClientId"] = "client-id",
            ["Social:FacebookAppId"] = "app-id",
            ["Social:FacebookAppSecret"] = "app-secret"
        });
        var withIds = SocialAuthSettings.BuildConfig(CreateEnv("Testing"), config);
        withIds.GoogleEnabled.Should().BeTrue();
        withIds.FacebookEnabled.Should().BeTrue();
        withIds.MockEnabled.Should().BeTrue();
        withIds.GoogleClientId.Should().Be("client-id");

        var empty = SocialAuthSettings.BuildConfig(CreateEnv("Production"), CreateConfig());
        empty.GoogleEnabled.Should().BeFalse();
        empty.FacebookEnabled.Should().BeFalse();
        empty.MockEnabled.Should().BeFalse();
    }
}
