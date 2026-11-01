using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Auth;

// DTOs
public record UserDto(Guid Id, string Email, string FullName, string? PhoneNumber, string? Address, string Role, string SessionId);
public record NotificationDto(Guid Id, string Title, string Message, string Type, bool IsRead, DateTime CreatedAt);

/// <summary>Kết quả đăng ký: tài khoản mới tạo ở trạng thái chờ xác thực email, CHƯA có session.</summary>
public record RegisterResponseDto(string Email, bool RequiresVerification, string? DebugCode);

/// <summary>Kết quả các request gửi OTP (verify/resend/forgot/otp-login). DebugCode chỉ có ở môi trường test/dev.</summary>
public record OtpRequestResponseDto(string? DebugCode);

/// <summary>
/// Policy mật khẩu dùng chung cho Đăng ký và Đặt lại mật khẩu (4 quy tắc):
/// ≥ 8 ký tự, ≥ 1 chữ hoa, ≥ 1 chữ số, ≥ 1 ký tự đặc biệt.
/// Trả về câu lỗi đầu tiên vi phạm, hoặc null nếu hợp lệ.
/// </summary>
public static class PasswordPolicy
{
    public static string? Validate(string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            return "Mật khẩu phải có tối thiểu 8 ký tự.";
        }

        if (!password.Any(char.IsUpper))
        {
            return "Mật khẩu phải chứa ít nhất 1 ký tự chữ hoa (A-Z).";
        }

        if (!password.Any(char.IsDigit))
        {
            return "Mật khẩu phải chứa ít nhất 1 chữ số (0-9).";
        }

        if (!password.Any(ch => !char.IsLetterOrDigit(ch)))
        {
            return "Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt (ví dụ: !@#$%^&*...).";
        }

        return null;
    }
}

/// <summary>Tạo session đăng nhập 7 ngày cho user (dùng chung: login, verify-email, otp-login).</summary>
public static class AuthSessionFactory
{
    public static async Task<UserDto> CreateSessionAsync(AppDbContext context, User user, CancellationToken cancellationToken)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        var session = new UserSession
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            UserId = user.Id,
            Email = user.Email,
            FullName = user.FullName,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        };

        await context.UserSessions.AddAsync(session, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        return new UserDto(user.Id, user.Email, user.FullName, user.PhoneNumber, user.Address, user.Role, sessionId);
    }
}

// 1. Register Command
public record RegisterCommand(string Email, string Password, string FullName, string? PhoneNumber, string? Address)
    : IRequest<ApiResponse<RegisterResponseDto>>;

public class RegisterCommandHandler : IRequestHandler<RegisterCommand, ApiResponse<RegisterResponseDto>>
{
    private readonly AppDbContext _context;
    private readonly IKafkaProducer _kafkaProducer;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;
    private readonly IOtpService _otpService;

    public RegisterCommandHandler(
        AppDbContext context,
        IKafkaProducer kafkaProducer,
        IHubContext<NotificationHub, INotificationClient> hubContext,
        IOtpService otpService)
    {
        _context = context;
        _kafkaProducer = kafkaProducer;
        _hubContext = hubContext;
        _otpService = otpService;
    }

    public async Task<ApiResponse<RegisterResponseDto>> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var passwordError = PasswordPolicy.Validate(request.Password);
        if (passwordError != null)
        {
            return ApiResponse<RegisterResponseDto>.Fail(passwordError);
        }

        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail, cancellationToken))
        {
            return ApiResponse<RegisterResponseDto>.Fail("Email này đã được sử dụng. Vui lòng chọn email khác hoặc đăng nhập.");
        }

        var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = passwordHash,
            FullName = request.FullName.Trim(),
            PhoneNumber = request.PhoneNumber?.Trim(),
            Address = request.Address?.Trim(),
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            // Nghiệp vụ v3: tài khoản mới tạo CHƯA được kích hoạt, phải xác thực email trước khi đăng nhập/mua hàng
            EmailVerified = false
        };

        var welcomeNotification = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Title = "Chào mừng thành viên mới!",
            Message = $"Xin chào {user.FullName}, chúc mừng bạn đã gia nhập DAFL Store. Nhập mã DAFL10 để được giảm 10% đơn hàng đầu tiên!",
            Type = "Promotion",
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        };

        await _context.Users.AddAsync(user, cancellationToken);
        await _context.Notifications.AddAsync(welcomeNotification, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);

        // Real-time notification via SignalR
        var notifDto = new NotificationDto(
            welcomeNotification.Id,
            welcomeNotification.Title,
            welcomeNotification.Message,
            welcomeNotification.Type,
            welcomeNotification.IsRead,
            welcomeNotification.CreatedAt
        );
        await _hubContext.Clients.Group(NotificationGroups.ForUser(user.Id)).ReceiveNotification(notifDto);

        // Kafka Event
        await _kafkaProducer.PublishAsync(
            "notification-events",
            user.Email,
            new NotificationEvent("USER_REGISTERED", user.Email, welcomeNotification.Title, welcomeNotification.Message, DateTime.UtcNow),
            cancellationToken
        );

        // Gửi mã xác thực về đúng email vừa đăng ký. KHÔNG tạo session ở bước này:
        // session chỉ được tạo sau khi xác thực email thành công (POST /api/auth/verify-email).
        var otpResult = await _otpService.IssueCodeAsync(user.Email, OtpPurposes.VerifyEmail, cancellationToken);

        var dto = new RegisterResponseDto(user.Email, RequiresVerification: true, otpResult.Success ? otpResult.DebugCode : null);
        return ApiResponse<RegisterResponseDto>.Ok(dto, "Đăng ký thành công. Vui lòng nhập mã xác thực đã gửi về email của bạn.");
    }
}

// 2. Login Command
public record LoginCommand(string Email, string Password) : IRequest<ApiResponse<UserDto>>;

public class LoginCommandHandler : IRequestHandler<LoginCommand, ApiResponse<UserDto>>
{
    private readonly AppDbContext _context;
    private readonly IKafkaProducer _kafkaProducer;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;

    public LoginCommandHandler(
        AppDbContext context, 
        IKafkaProducer kafkaProducer,
        IHubContext<NotificationHub, INotificationClient> hubContext)
    {
        _context = context;
        _kafkaProducer = kafkaProducer;
        _hubContext = hubContext;
    }

    public async Task<ApiResponse<UserDto>> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);
        var now = DateTime.UtcNow;

        if (user == null)
        {
            return ApiResponse<UserDto>.Fail("Email hoặc mật khẩu không chính xác.");
        }

        // (a) Đang bị khóa mềm: từ chối bằng câu lỗi chung, kể cả khi mật khẩu đúng
        // (không lộ thông tin tài khoản đang bị khóa; chủ tài khoản mở khóa ngay bằng OTP).
        if (user.LockedUntil.HasValue && user.LockedUntil.Value > now)
        {
            return ApiResponse<UserDto>.Fail("Email hoặc mật khẩu không chính xác.");
        }

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            // (b) Sai mật khẩu: đếm theo cửa sổ trượt 15 phút, sai 10 lần trong cửa sổ → khóa mềm.
            if (!user.FailedLoginWindowStart.HasValue || (now - user.FailedLoginWindowStart.Value).TotalMinutes > 15)
            {
                user.FailedLoginWindowStart = now;
                user.FailedLoginCount = 1;
            }
            else
            {
                user.FailedLoginCount++;
            }

            if (user.FailedLoginCount >= 10)
            {
                var lockMinutes = Math.Min(15 * (int)Math.Pow(2, user.LockEscalations), 60);
                user.LockedUntil = now.AddMinutes(lockMinutes);
                user.LockEscalations++;
                user.FailedLoginCount = 0;
                user.FailedLoginWindowStart = null;
            }

            await _context.SaveChangesAsync(cancellationToken);
            return ApiResponse<UserDto>.Fail("Email hoặc mật khẩu không chính xác.");
        }

        // (c) Đúng mật khẩu nhưng email chưa xác thực → chặn, chuyển tới bước nhập mã xác thực
        if (!user.EmailVerified)
        {
            return ApiResponse<UserDto>.Fail("Tài khoản chưa được xác thực. Vui lòng nhập mã đã gửi về email của bạn.");
        }

        // (d) Đúng + đã xác thực: reset bộ đếm sai, tạo session như cũ
        user.FailedLoginCount = 0;
        user.FailedLoginWindowStart = null;
        user.LockedUntil = null;
        await _context.SaveChangesAsync(cancellationToken);

        var userDto = await AuthSessionFactory.CreateSessionAsync(_context, user, cancellationToken);

        // Real-time login alert via SignalR
        var loginNotif = new NotificationDto(
            Guid.NewGuid(),
            "Đăng nhập thành công",
            $"Tài khoản {user.FullName} vừa đăng nhập vào hệ thống.",
            "System",
            false,
            DateTime.UtcNow
        );
        await _hubContext.Clients.Group(NotificationGroups.ForUser(user.Id)).ReceiveNotification(loginNotif);

        await _kafkaProducer.PublishAsync(
            "notification-events",
            user.Email,
            new NotificationEvent("USER_LOGIN", user.Email, "Đăng nhập thành công", $"Xin chào {user.FullName}, bạn vừa đăng nhập vào hệ thống DAFL.", DateTime.UtcNow),
            cancellationToken
        );

        return ApiResponse<UserDto>.Ok(userDto, "Đăng nhập thành công.");
    }
}
