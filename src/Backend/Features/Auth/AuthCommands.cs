using System.Text.RegularExpressions;
using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Auth;

// DTOs
// HasPassword: tài khoản đã có mật khẩu hay chưa (false = tài khoản social thuần túy → FE hiện form "Đặt mật khẩu").
// AuthProvider: nhà cung cấp social đã liên kết đầu tiên ("google"/"facebook"), null nếu tài khoản chỉ dùng mật khẩu.
public record UserDto(Guid Id, string Email, string FullName, string? PhoneNumber, string? Address, string Role, bool HasPassword = true, string? AuthProvider = null);

/// <summary>Kết quả xác thực thành công (đăng nhập / đăng ký / social): JWT hạn 1 giờ + thông tin user (CN-02).</summary>
public record AuthResultDto(string Token, UserDto User, DateTime ExpiresAt);

public record NotificationDto(Guid Id, string Title, string Message, string Type, bool IsRead, DateTime CreatedAt);

/// <summary>
/// Policy mật khẩu dùng chung cho Đăng ký / Đổi mật khẩu / Đặt lại mật khẩu / Đặt mật khẩu social.
/// GIỮ NGUYÊN policy nghiêm ngặt của bản v3 (Daniel chốt lại 2026-11-01, hủy override O2 của CN):
/// ≥ 8 ký tự, ≥ 1 chữ hoa, ≥ 1 chữ số, ≥ 1 ký tự đặc biệt. Trả về câu lỗi đầu tiên vi phạm, hoặc null nếu hợp lệ.
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

/// <summary>Validate dùng chung cho họ tên / email / SĐT theo CN-01 (câu chữ đúng đặc tả).</summary>
public static class IdentityValidation
{
    public static readonly Regex VietnamPhoneRegex = new(@"^0\d{9}$", RegexOptions.Compiled);
    public static readonly Regex EmailRegex = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    public static string? ValidateFullName(string? fullName)
        => string.IsNullOrWhiteSpace(fullName) || fullName.Trim().Length < 2 || fullName.Trim().Length > 50
            ? "Họ tên không hợp lệ"
            : null;

    public static string? ValidateEmailFormat(string? email)
        => string.IsNullOrWhiteSpace(email) || !EmailRegex.IsMatch(email.Trim())
            ? "Email không hợp lệ"
            : null;

    public static string? ValidatePhoneFormat(string? phone)
        => string.IsNullOrWhiteSpace(phone) || !VietnamPhoneRegex.IsMatch(phone.Trim())
            ? "Số điện thoại không hợp lệ"
            : null;
}

/// <summary>Cấp JWT + dựng UserDto (dùng chung: login, register, social — CN-02).</summary>
public static class AuthTokenFactory
{
    public static async Task<AuthResultDto> CreateAuthResultAsync(
        AppDbContext context, IJwtService jwtService, User user, CancellationToken cancellationToken)
    {
        var userDto = await BuildUserDtoAsync(context, user, cancellationToken);
        var token = jwtService.CreateToken(user, out var expiresAt);
        return new AuthResultDto(token, userDto, expiresAt);
    }

    /// <summary>Dựng UserDto kèm HasPassword + AuthProvider (dùng chung mọi endpoint trả thông tin user).</summary>
    public static async Task<UserDto> BuildUserDtoAsync(AppDbContext context, User user, CancellationToken cancellationToken)
    {
        var provider = await context.UserExternalIdentities
            .AsNoTracking()
            .Where(i => i.UserId == user.Id)
            .OrderBy(i => i.CreatedAt)
            .Select(i => i.Provider)
            .FirstOrDefaultAsync(cancellationToken);

        return new UserDto(
            user.Id,
            user.Email,
            user.FullName,
            user.PhoneNumber,
            user.Address,
            user.Role,
            HasPassword: !string.IsNullOrEmpty(user.PasswordHash),
            AuthProvider: provider);
    }
}

// 1. Register Command — CN-01: KHÔNG còn OTP/xác thực email, tài khoản dùng ngay
public record RegisterCommand(string Email, string Password, string FullName, string? PhoneNumber, string? Address, string? ConfirmPassword = null)
    : IRequest<ApiResponse<AuthResultDto>>;

public class RegisterCommandHandler : IRequestHandler<RegisterCommand, ApiResponse<AuthResultDto>>
{
    private readonly AppDbContext _context;
    private readonly IKafkaProducer _kafkaProducer;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;
    private readonly IJwtService _jwtService;

    public RegisterCommandHandler(
        AppDbContext context,
        IKafkaProducer kafkaProducer,
        IHubContext<NotificationHub, INotificationClient> hubContext,
        IJwtService jwtService)
    {
        _context = context;
        _kafkaProducer = kafkaProducer;
        _hubContext = hubContext;
        _jwtService = jwtService;
    }

    public async Task<ApiResponse<AuthResultDto>> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        // Trim khoảng trắng đầu/cuối mọi trường text trước khi validate và lưu
        var normalizedEmail = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var fullName = (request.FullName ?? string.Empty).Trim();
        var phoneNumber = request.PhoneNumber?.Trim();
        var address = request.Address?.Trim();

        // Validate đúng câu chữ CN-01
        if (IdentityValidation.ValidateFullName(fullName) is { } nameError)
        {
            return ApiResponse<AuthResultDto>.Fail(nameError);
        }

        if (IdentityValidation.ValidateEmailFormat(normalizedEmail) is { } emailError)
        {
            return ApiResponse<AuthResultDto>.Fail(emailError);
        }

        // SĐT BẮT BUỘC theo CN-01 (10 số, bắt đầu bằng 0) và phải duy nhất
        if (IdentityValidation.ValidatePhoneFormat(phoneNumber) is { } phoneError)
        {
            return ApiResponse<AuthResultDto>.Fail(phoneError);
        }

        var passwordError = PasswordPolicy.Validate(request.Password);
        if (passwordError != null)
        {
            return ApiResponse<AuthResultDto>.Fail(passwordError);
        }

        if (!string.IsNullOrEmpty(request.ConfirmPassword) && request.ConfirmPassword != request.Password)
        {
            return ApiResponse<AuthResultDto>.Fail("Mật khẩu xác nhận không khớp");
        }

        if (await _context.Users.AnyAsync(u => u.Email == normalizedEmail, cancellationToken))
        {
            return ApiResponse<AuthResultDto>.Fail("Email đã được sử dụng");
        }

        if (await _context.Users.AnyAsync(u => u.PhoneNumber == phoneNumber, cancellationToken))
        {
            return ApiResponse<AuthResultDto>.Fail("Số điện thoại đã được sử dụng");
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            FullName = fullName,
            PhoneNumber = phoneNumber,
            Address = string.IsNullOrEmpty(address) ? null : address,
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            // CN-01: không có bước xác thực email — tài khoản hoạt động ngay sau khi đăng ký
            EmailVerified = true,
            EmailVerifiedAt = DateTime.UtcNow
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

        var notifDto = new NotificationDto(
            welcomeNotification.Id,
            welcomeNotification.Title,
            welcomeNotification.Message,
            welcomeNotification.Type,
            welcomeNotification.IsRead,
            welcomeNotification.CreatedAt
        );
        await _hubContext.Clients.Group(NotificationGroups.ForUser(user.Id)).ReceiveNotification(notifDto);

        await _kafkaProducer.PublishAsync(
            "notification-events",
            user.Email,
            new NotificationEvent("USER_REGISTERED", user.Email, welcomeNotification.Title, welcomeNotification.Message, DateTime.UtcNow),
            cancellationToken
        );

        var authResult = await AuthTokenFactory.CreateAuthResultAsync(_context, _jwtService, user, cancellationToken);
        return ApiResponse<AuthResultDto>.Ok(authResult, "Đăng ký thành công");
    }
}

// 2. Login Command — CN-02: sai thông tin → một câu chung "Email hoặc mật khẩu không đúng"
public record LoginCommand(string Email, string Password) : IRequest<ApiResponse<AuthResultDto>>;

public class LoginCommandHandler : IRequestHandler<LoginCommand, ApiResponse<AuthResultDto>>
{
    private readonly AppDbContext _context;
    private readonly IKafkaProducer _kafkaProducer;
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;
    private readonly IJwtService _jwtService;

    public LoginCommandHandler(
        AppDbContext context,
        IKafkaProducer kafkaProducer,
        IHubContext<NotificationHub, INotificationClient> hubContext,
        IJwtService jwtService)
    {
        _context = context;
        _kafkaProducer = kafkaProducer;
        _hubContext = hubContext;
        _jwtService = jwtService;
    }

    public async Task<ApiResponse<AuthResultDto>> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        // Tài khoản social thuần túy (PasswordHash = null) cũng rơi vào câu lỗi chung này.
        var passwordMatches = user != null
            && !string.IsNullOrEmpty(user.PasswordHash)
            && BCrypt.Net.BCrypt.Verify(request.Password ?? string.Empty, user.PasswordHash);

        if (user == null || !passwordMatches)
        {
            // CN-02 E1: không nêu rõ sai email hay mật khẩu; CN bỏ hẳn khóa mềm tài khoản.
            return ApiResponse<AuthResultDto>.Fail("Email hoặc mật khẩu không đúng");
        }

        var authResult = await AuthTokenFactory.CreateAuthResultAsync(_context, _jwtService, user, cancellationToken);

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

        return ApiResponse<AuthResultDto>.Ok(authResult, "Đăng nhập thành công.");
    }
}
