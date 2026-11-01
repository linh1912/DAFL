using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace DAFL.Backend.Features.Auth;

// ==========================================
// Luồng 6 — Đăng nhập/Đăng ký bằng Google & Facebook (bản chốt v4, Mục 9)
// Token do FE lấy từ nhà cung cấp; BE đã xác thực token (IExternalAuthVerifier)
// trước khi gửi command này. Mock social dùng cho Development/Testing (Mục 9.5).
// ==========================================

/// <summary>Cấu hình public cho FE: provider nào đang bật + ClientId/AppId công khai (không chứa secret).</summary>
public record SocialConfigDto(bool GoogleEnabled, bool FacebookEnabled, bool MockEnabled, string? GoogleClientId, string? FacebookAppId);

public static class SocialAuthSettings
{
    /// <summary>Mock social chỉ bật ở Development/Testing hoặc khi Social:MockEnabled = true. Production: tắt cứng.</summary>
    public static bool IsMockEnabled(IHostEnvironment env, IConfiguration configuration)
    {
        if (env.IsProduction()) return false;
        return env.IsDevelopment()
            || string.Equals(env.EnvironmentName, "Testing", StringComparison.OrdinalIgnoreCase)
            || configuration.GetValue<bool>("Social:MockEnabled", false);
    }

    public static SocialConfigDto BuildConfig(IHostEnvironment env, IConfiguration configuration)
    {
        var googleClientId = configuration["Social:GoogleClientId"];
        var facebookAppId = configuration["Social:FacebookAppId"];
        var facebookAppSecret = configuration["Social:FacebookAppSecret"];

        return new SocialConfigDto(
            GoogleEnabled: !string.IsNullOrWhiteSpace(googleClientId),
            FacebookEnabled: !string.IsNullOrWhiteSpace(facebookAppId) && !string.IsNullOrWhiteSpace(facebookAppSecret),
            MockEnabled: IsMockEnabled(env, configuration),
            GoogleClientId: string.IsNullOrWhiteSpace(googleClientId) ? null : googleClientId,
            FacebookAppId: string.IsNullOrWhiteSpace(facebookAppId) ? null : facebookAppId);
    }
}

/// <summary>
/// Tìm đúng tài khoản cho một định danh ngoài theo quy tắc liên kết L1–L3 (bản v4, Mục 9.2):
/// L1: đã có định danh → đúng tài khoản đó. L2: email trùng + đã được nhà cung cấp xác thực →
/// tự liên kết (+ kích hoạt nếu tài khoản đang chờ xác thực). L3: không trùng → tạo tài khoản mới
/// (EmailVerified = true, PasswordHash = null). Trả null nếu nhà cung cấp không trả email (L4 —
/// cần luồng bổ sung email riêng, không tạo tài khoản "mồ côi").
/// </summary>
public static class SocialAccountResolver
{
    public static async Task<User?> ResolveAsync(AppDbContext context, ExternalProfile profile, CancellationToken cancellationToken)
    {
        // L1: định danh đã tồn tại
        var identity = await context.UserExternalIdentities
            .Include(i => i.User)
            .FirstOrDefaultAsync(i => i.Provider == profile.Provider && i.ProviderUserId == profile.ProviderUserId, cancellationToken);
        if (identity?.User != null)
        {
            // Cập nhật họ tên/ảnh nếu nhà cung cấp đổi và tài khoản chưa có dữ liệu riêng
            if (!string.IsNullOrWhiteSpace(profile.FullName) && identity.User.FullName != profile.FullName)
            {
                identity.User.FullName = profile.FullName!;
            }
            if (!string.IsNullOrWhiteSpace(profile.AvatarUrl) && string.IsNullOrWhiteSpace(identity.User.AvatarUrl))
            {
                identity.User.AvatarUrl = profile.AvatarUrl;
            }
            await context.SaveChangesAsync(cancellationToken);
            return identity.User;
        }

        if (string.IsNullOrWhiteSpace(profile.Email))
        {
            // L4: không có email → không tạo/liên kết được
            return null;
        }

        var email = profile.Email.Trim().ToLowerInvariant();

        // L2: email trùng tài khoản sẵn có
        var existingUser = await context.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (existingUser != null)
        {
            if (!profile.EmailVerified)
            {
                // Chỉ tự liên kết khi email đã được nhà cung cấp xác thực — không nới điều kiện này.
                return null;
            }

            context.UserExternalIdentities.Add(new UserExternalIdentity
            {
                Id = Guid.NewGuid(),
                UserId = existingUser.Id,
                Provider = profile.Provider,
                ProviderUserId = profile.ProviderUserId,
                Email = email,
                CreatedAt = DateTime.UtcNow
            });

            if (!existingUser.EmailVerified)
            {
                existingUser.EmailVerified = true;
                existingUser.EmailVerifiedAt = DateTime.UtcNow;
            }
            if (!string.IsNullOrWhiteSpace(profile.AvatarUrl) && string.IsNullOrWhiteSpace(existingUser.AvatarUrl))
            {
                existingUser.AvatarUrl = profile.AvatarUrl;
            }

            await context.SaveChangesAsync(cancellationToken);
            return existingUser;
        }

        // L3: tạo tài khoản mới — email đã được nhà cung cấp xác thực thay cho OTP
        var newUser = new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            PasswordHash = null,
            FullName = !string.IsNullOrWhiteSpace(profile.FullName) ? profile.FullName!.Trim() : email,
            AvatarUrl = profile.AvatarUrl,
            Role = "Customer",
            CreatedAt = DateTime.UtcNow,
            EmailVerified = true,
            EmailVerifiedAt = DateTime.UtcNow
        };

        context.Users.Add(newUser);
        context.UserExternalIdentities.Add(new UserExternalIdentity
        {
            Id = Guid.NewGuid(),
            UserId = newUser.Id,
            Provider = profile.Provider,
            ProviderUserId = profile.ProviderUserId,
            Email = email,
            CreatedAt = DateTime.UtcNow
        });
        context.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = newUser.Id,
            Title = "Chào mừng thành viên mới!",
            Message = $"Xin chào {newUser.FullName}, chúc mừng bạn đã gia nhập DAFL Store. Nhập mã DAFL10 để được giảm 10% đơn hàng đầu tiên!",
            Type = "Promotion",
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        });

        await context.SaveChangesAsync(cancellationToken);
        return newUser;
    }
}

// 1. Social login bằng token thật (đã verify ở endpoint qua IExternalAuthVerifier)
public record SocialLoginCommand(ExternalProfile Profile) : IRequest<ApiResponse<AuthResultDto>>;

public class SocialLoginCommandHandler : IRequestHandler<SocialLoginCommand, ApiResponse<AuthResultDto>>
{
    private readonly AppDbContext _context;
    private readonly IJwtService _jwtService;

    public SocialLoginCommandHandler(AppDbContext context, IJwtService jwtService)
    {
        _context = context;
        _jwtService = jwtService;
    }

    public async Task<ApiResponse<AuthResultDto>> Handle(SocialLoginCommand request, CancellationToken cancellationToken)
    {
        var profile = request.Profile;

        if (string.IsNullOrWhiteSpace(profile.Email))
        {
            var providerName = profile.Provider == SocialProviders.Google ? "Google" : "Facebook";
            return ApiResponse<AuthResultDto>.Fail($"Tài khoản {providerName} không cung cấp địa chỉ email. Vui lòng cấp quyền email hoặc đăng ký bằng email và mật khẩu.");
        }

        var user = await SocialAccountResolver.ResolveAsync(_context, profile, cancellationToken);
        if (user == null)
        {
            return ApiResponse<AuthResultDto>.Fail("Không thể liên kết tài khoản mạng xã hội này. Vui lòng thử cách đăng nhập khác.");
        }

        // Mọi đường thành công đều cấp JWT 1 giờ giống hệt đăng nhập mật khẩu (CN-02)
        var authResult = await AuthTokenFactory.CreateAuthResultAsync(_context, _jwtService, user, cancellationToken);
        return ApiResponse<AuthResultDto>.Ok(authResult, "Đăng nhập thành công.");
    }
}

// 2. Mock social login — CHỈ Development/Testing (Mục 9.5): 1 user mẫu cố định cho mỗi provider
public record MockSocialLoginCommand(string Provider) : IRequest<ApiResponse<AuthResultDto>>;

public class MockSocialLoginCommandHandler : IRequestHandler<MockSocialLoginCommand, ApiResponse<AuthResultDto>>
{
    private readonly AppDbContext _context;
    private readonly IHostEnvironment _environment;
    private readonly IConfiguration _configuration;
    private readonly IJwtService _jwtService;

    public MockSocialLoginCommandHandler(AppDbContext context, IHostEnvironment environment, IConfiguration configuration, IJwtService jwtService)
    {
        _context = context;
        _environment = environment;
        _configuration = configuration;
        _jwtService = jwtService;
    }

    public static ExternalProfile MockProfileFor(string provider) => provider switch
    {
        SocialProviders.Google => new ExternalProfile(
            SocialProviders.Google, "mock-google-001", "google.test@dafl.vn", true, "Người Dùng Google Test", null),
        SocialProviders.Facebook => new ExternalProfile(
            SocialProviders.Facebook, "mock-facebook-001", "facebook.test@dafl.vn", true, "Người Dùng Facebook Test", null),
        _ => throw new ArgumentOutOfRangeException(nameof(provider), provider, "Provider không được hỗ trợ.")
    };

    public async Task<ApiResponse<AuthResultDto>> Handle(MockSocialLoginCommand request, CancellationToken cancellationToken)
    {
        if (!SocialAuthSettings.IsMockEnabled(_environment, _configuration))
        {
            return ApiResponse<AuthResultDto>.Fail("Đăng nhập giả lập chỉ khả dụng ở môi trường kiểm thử.");
        }

        if (request.Provider != SocialProviders.Google && request.Provider != SocialProviders.Facebook)
        {
            return ApiResponse<AuthResultDto>.Fail("Nhà cung cấp đăng nhập không được hỗ trợ.");
        }

        var user = await SocialAccountResolver.ResolveAsync(_context, MockProfileFor(request.Provider), cancellationToken);
        if (user == null)
        {
            return ApiResponse<AuthResultDto>.Fail("Không thể đăng nhập giả lập.");
        }

        var authResult = await AuthTokenFactory.CreateAuthResultAsync(_context, _jwtService, user, cancellationToken);
        return ApiResponse<AuthResultDto>.Ok(authResult, "Đăng nhập thành công.");
    }
}

// 3. Đặt mật khẩu lần đầu cho tài khoản social (tài khoản đã có mật khẩu thì từ chối — đổi mật khẩu là luồng khác)
public record SetPasswordCommand(Guid UserId, string NewPassword) : IRequest<ApiResponse<string>>;

public class SetPasswordCommandHandler : IRequestHandler<SetPasswordCommand, ApiResponse<string>>
{
    private readonly AppDbContext _context;

    public SetPasswordCommandHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<string>> Handle(SetPasswordCommand request, CancellationToken cancellationToken)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user == null)
        {
            return ApiResponse<string>.Fail("Không tìm thấy tài khoản.");
        }

        if (!string.IsNullOrEmpty(user.PasswordHash))
        {
            return ApiResponse<string>.Fail("Tài khoản đã có mật khẩu. Vui lòng dùng chức năng đổi mật khẩu.");
        }

        var passwordError = PasswordPolicy.Validate(request.NewPassword);
        if (passwordError != null)
        {
            return ApiResponse<string>.Fail(passwordError);
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        await _context.SaveChangesAsync(cancellationToken);

        return ApiResponse<string>.Ok("Đặt mật khẩu thành công. Từ nay bạn có thể đăng nhập bằng email và mật khẩu.");
    }
}
