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
/// Tests cho nghiệp vụ auth v3 (bản chốt): xác thực email bằng OTP sau đăng ký,
/// chặn đăng nhập khi chưa xác thực, policy mật khẩu có chữ số,
/// khóa mềm sau 10 lần sai mật khẩu, quên/đặt lại mật khẩu, đăng nhập OTP mở khóa.
/// Môi trường test = "Testing" → OtpService trả debugCode (mock OTP như mock PayOS).
/// </summary>
public class OtpAuthTests : IDisposable
{
    private readonly AppDbContext _context;
    private readonly Mock<IKafkaProducer> _mockKafkaProducer;
    private readonly Mock<IHubContext<NotificationHub, INotificationClient>> _mockHubContext;
    private readonly Mock<INotificationClient> _mockClients;
    private readonly OtpService _otpService;

    public OtpAuthTests()
    {
        _context = TestDbContextFactory.Create();
        _mockKafkaProducer = new Mock<IKafkaProducer>();
        _mockHubContext = new Mock<IHubContext<NotificationHub, INotificationClient>>();
        _mockClients = new Mock<INotificationClient>();
        _mockHubContext.Setup(h => h.Clients.Group(It.IsAny<string>())).Returns(_mockClients.Object);
        _mockClients.Setup(c => c.ReceiveNotification(It.IsAny<object>())).Returns(Task.CompletedTask);
        _otpService = OtpTestFactory.CreateOtpService(_context);
    }

    public void Dispose() => _context.Dispose();

    private RegisterCommandHandler RegisterHandler =>
        new(_context, _mockKafkaProducer.Object, _mockHubContext.Object, _otpService);

    private LoginCommandHandler LoginHandler =>
        new(_context, _mockKafkaProducer.Object, _mockHubContext.Object);

    private async Task<User> SeedVerifiedUserAsync(string email, string password)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            FullName = "OTP Test User",
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            EmailVerified = true,
            EmailVerifiedAt = DateTime.UtcNow
        };
        _context.Users.Add(user);
        await _context.SaveChangesAsync();
        return user;
    }

    /// <summary>TC-REG-NEW-01: Mật khẩu không có chữ số → Fail đúng câu lỗi rule chữ số.</summary>
    [Fact]
    public async Task Register_PasswordWithoutDigit_ShouldReturnFail()
    {
        var command = new RegisterCommand("nodigit@dafl.vn", "Password@abc", "No Digit", null, null);

        var result = await RegisterHandler.Handle(command, CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Mật khẩu phải chứa ít nhất 1 chữ số (0-9).");
    }

    /// <summary>TC-REG-NEW-02: Đăng ký → nhập đúng mã (debugCode) → verified, có session, đăng nhập được.</summary>
    [Fact]
    public async Task VerifyEmail_WithCorrectCode_ShouldVerifyAndCreateSession()
    {
        var registerResult = await RegisterHandler.Handle(
            new RegisterCommand("verifyme@dafl.vn", "SecurePass@123", "Verify Me", null, null),
            CancellationToken.None);
        registerResult.Success.Should().BeTrue();
        var code = registerResult.Data!.DebugCode;
        code.Should().NotBeNullOrEmpty();

        var verifyHandler = new VerifyEmailCommandHandler(_context, _otpService);
        var verifyResult = await verifyHandler.Handle(new VerifyEmailCommand("verifyme@dafl.vn", code!), CancellationToken.None);

        verifyResult.Success.Should().BeTrue();
        verifyResult.Message.Should().Contain("Xác thực email thành công");
        verifyResult.Data!.SessionId.Should().NotBeNullOrEmpty();

        var user = await _context.Users.FirstAsync(u => u.Email == "verifyme@dafl.vn");
        user.EmailVerified.Should().BeTrue();
        user.EmailVerifiedAt.Should().NotBeNull();

        // Mã đã dùng 1 lần → dùng lại phải bị từ chối
        var reuseResult = await verifyHandler.Handle(new VerifyEmailCommand("verifyme@dafl.vn", code!), CancellationToken.None);
        reuseResult.Success.Should().BeFalse();
    }

    /// <summary>TC-REG-NEW-03: Nhập sai mã → báo còn X lần thử; sai 5 lần → mã bị vô hiệu.</summary>
    [Fact]
    public async Task VerifyEmail_WithWrongCode_ShouldCountAttemptsAndVoidAfter5()
    {
        var registerResult = await RegisterHandler.Handle(
            new RegisterCommand("wrongcode@dafl.vn", "SecurePass@123", "Wrong Code", null, null),
            CancellationToken.None);
        var correctCode = registerResult.Data!.DebugCode!;
        var wrongCode = correctCode == "000000" ? "111111" : "000000";
        var verifyHandler = new VerifyEmailCommandHandler(_context, _otpService);

        var first = await verifyHandler.Handle(new VerifyEmailCommand("wrongcode@dafl.vn", wrongCode), CancellationToken.None);
        first.Success.Should().BeFalse();
        first.Message.Should().Be("Mã xác nhận không đúng. Bạn còn 4 lần thử.");

        for (var i = 0; i < 3; i++)
        {
            await verifyHandler.Handle(new VerifyEmailCommand("wrongcode@dafl.vn", wrongCode), CancellationToken.None);
        }

        var fifth = await verifyHandler.Handle(new VerifyEmailCommand("wrongcode@dafl.vn", wrongCode), CancellationToken.None);
        fifth.Success.Should().BeFalse();
        fifth.Message.Should().Contain("Mã đã bị vô hiệu do nhập sai quá 5 lần");

        // Sau khi vô hiệu, nhập ĐÚNG mã cũ cũng bị từ chối
        var afterVoid = await verifyHandler.Handle(new VerifyEmailCommand("wrongcode@dafl.vn", correctCode), CancellationToken.None);
        afterVoid.Success.Should().BeFalse();
    }

    /// <summary>TC-REG-NEW-04: Chưa xác thực email → đăng nhập đúng mật khẩu vẫn bị chặn.</summary>
    [Fact]
    public async Task Login_BeforeEmailVerification_ShouldBeBlocked()
    {
        await RegisterHandler.Handle(
            new RegisterCommand("blocked@dafl.vn", "SecurePass@123", "Blocked User", null, null),
            CancellationToken.None);

        var result = await LoginHandler.Handle(new LoginCommand("blocked@dafl.vn", "SecurePass@123"), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Tài khoản chưa được xác thực. Vui lòng nhập mã đã gửi về email của bạn.");
    }

    /// <summary>TC-LOCK-NEW-01: Sai mật khẩu 10 lần trong cửa sổ 15 phút → khóa mềm; mật khẩu đúng cũng bị từ chối.</summary>
    [Fact]
    public async Task Login_After10WrongAttempts_ShouldSoftLockAccount()
    {
        await SeedVerifiedUserAsync("lockme@dafl.vn", "Test@1234");

        for (var i = 0; i < 10; i++)
        {
            var fail = await LoginHandler.Handle(new LoginCommand("lockme@dafl.vn", "WrongPass@9"), CancellationToken.None);
            fail.Success.Should().BeFalse();
            fail.Message.Should().Be("Email hoặc mật khẩu không chính xác.");
        }

        var user = await _context.Users.FirstAsync(u => u.Email == "lockme@dafl.vn");
        user.LockedUntil.Should().NotBeNull();
        user.LockedUntil!.Value.Should().BeAfter(DateTime.UtcNow);
        user.LockEscalations.Should().Be(1);

        // Đang khóa: mật khẩu ĐÚNG vẫn bị từ chối bằng câu lỗi chung
        var lockedAttempt = await LoginHandler.Handle(new LoginCommand("lockme@dafl.vn", "Test@1234"), CancellationToken.None);
        lockedAttempt.Success.Should().BeFalse();
        lockedAttempt.Message.Should().Be("Email hoặc mật khẩu không chính xác.");
    }

    /// <summary>TC-LOCK-NEW-02: Đang bị khóa mềm → đăng nhập bằng OTP đúng → mở khóa ngay + đăng nhập thành công.</summary>
    [Fact]
    public async Task OtpLogin_WhenLocked_ShouldUnlockAndLogin()
    {
        var user = await SeedVerifiedUserAsync("unlockme@dafl.vn", "Test@1234");
        user.LockedUntil = DateTime.UtcNow.AddMinutes(15);
        user.FailedLoginCount = 0;
        await _context.SaveChangesAsync();

        var requestHandler = new OtpLoginRequestCommandHandler(_context, _otpService);
        var requestResult = await requestHandler.Handle(new OtpLoginRequestCommand("unlockme@dafl.vn"), CancellationToken.None);
        requestResult.Success.Should().BeTrue();
        var code = requestResult.Data!.DebugCode;
        code.Should().NotBeNullOrEmpty();

        var verifyHandler = new OtpLoginVerifyCommandHandler(_context, _otpService);
        var verifyResult = await verifyHandler.Handle(new OtpLoginVerifyCommand("unlockme@dafl.vn", code!), CancellationToken.None);

        verifyResult.Success.Should().BeTrue();
        verifyResult.Data!.SessionId.Should().NotBeNullOrEmpty();

        var refreshed = await _context.Users.FirstAsync(u => u.Email == "unlockme@dafl.vn");
        refreshed.LockedUntil.Should().BeNull();
        refreshed.FailedLoginCount.Should().Be(0);
    }

    /// <summary>TC-FP-NEW-01: Quên mật khẩu → đặt lại → session cũ bị hủy, mật khẩu cũ chết, mật khẩu mới sống.</summary>
    [Fact]
    public async Task ForgotAndResetPassword_HappyPath_ShouldRevokeSessionsAndChangePassword()
    {
        var user = await SeedVerifiedUserAsync("forgot@dafl.vn", "OldPass@123");

        // Tạo 1 session cũ đang đăng nhập
        await AuthSessionFactory.CreateSessionAsync(_context, user, CancellationToken.None);
        (await _context.UserSessions.CountAsync(s => s.UserId == user.Id)).Should().Be(1);

        var forgotHandler = new ForgotPasswordCommandHandler(_context, _otpService);
        var forgotResult = await forgotHandler.Handle(new ForgotPasswordCommand("forgot@dafl.vn"), CancellationToken.None);
        forgotResult.Success.Should().BeTrue();
        forgotResult.Message.Should().Be("Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.");
        var code = forgotResult.Data!.DebugCode;
        code.Should().NotBeNullOrEmpty();

        var resetHandler = new ResetPasswordCommandHandler(_context, _otpService);
        var resetResult = await resetHandler.Handle(
            new ResetPasswordCommand("forgot@dafl.vn", code!, "NewPass@456"), CancellationToken.None);
        resetResult.Success.Should().BeTrue();
        // ApiResponse<string>: câu thông báo nằm ở Data (giống pattern sẵn có của endpoint logout)
        resetResult.Data.Should().Contain("Đặt lại mật khẩu thành công");

        (await _context.UserSessions.CountAsync(s => s.UserId == user.Id)).Should().Be(0);

        var oldLogin = await LoginHandler.Handle(new LoginCommand("forgot@dafl.vn", "OldPass@123"), CancellationToken.None);
        oldLogin.Success.Should().BeFalse();

        var newLogin = await LoginHandler.Handle(new LoginCommand("forgot@dafl.vn", "NewPass@456"), CancellationToken.None);
        newLogin.Success.Should().BeTrue();
    }

    /// <summary>TC-FP-NEW-02: Đặt lại với mật khẩu mới trùng mật khẩu cũ → Fail, mã OTP không bị đốt oan.</summary>
    [Fact]
    public async Task ResetPassword_WithSameAsOldPassword_ShouldReturnFail()
    {
        await SeedVerifiedUserAsync("samepw@dafl.vn", "OldPass@123");

        var forgotHandler = new ForgotPasswordCommandHandler(_context, _otpService);
        var forgotResult = await forgotHandler.Handle(new ForgotPasswordCommand("samepw@dafl.vn"), CancellationToken.None);
        var code = forgotResult.Data!.DebugCode!;

        var resetHandler = new ResetPasswordCommandHandler(_context, _otpService);
        var result = await resetHandler.Handle(
            new ResetPasswordCommand("samepw@dafl.vn", code, "OldPass@123"), CancellationToken.None);

        result.Success.Should().BeFalse();
        result.Message.Should().Be("Mật khẩu mới không được trùng với mật khẩu cũ.");
    }

    /// <summary>TC-FP-NEW-03: Forgot-password với email không tồn tại → vẫn Ok generic, không lộ thông tin.</summary>
    [Fact]
    public async Task ForgotPassword_WithNonExistentEmail_ShouldReturnGenericOk()
    {
        var forgotHandler = new ForgotPasswordCommandHandler(_context, _otpService);
        var result = await forgotHandler.Handle(new ForgotPasswordCommand("ghost@dafl.vn"), CancellationToken.None);

        result.Success.Should().BeTrue();
        result.Message.Should().Be("Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.");
        result.Data!.DebugCode.Should().BeNull();
    }
}
