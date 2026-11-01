using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Auth;

// ==========================================
// Xác thực email sau đăng ký (Luồng 4, bản chốt v3)
// ==========================================

public record VerifyEmailCommand(string Email, string Code) : IRequest<ApiResponse<UserDto>>;

public class VerifyEmailCommandHandler : IRequestHandler<VerifyEmailCommand, ApiResponse<UserDto>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public VerifyEmailCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<UserDto>> Handle(VerifyEmailCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var verify = await _otpService.VerifyCodeAsync(normalizedEmail, OtpPurposes.VerifyEmail, request.Code, consume: true, cancellationToken);
        if (!verify.Success)
        {
            return ApiResponse<UserDto>.Fail(verify.ErrorMessage!);
        }

        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);
        if (user == null)
        {
            return ApiResponse<UserDto>.Fail("Mã xác nhận không đúng. Bạn còn 5 lần thử.");
        }

        user.EmailVerified = true;
        user.EmailVerifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);

        // Xác thực thành công → tự đăng nhập: tạo session giống hệt luồng login
        var userDto = await AuthSessionFactory.CreateSessionAsync(_context, user, cancellationToken);
        return ApiResponse<UserDto>.Ok(userDto, "Xác thực email thành công!");
    }
}

public record ResendVerificationCommand(string Email) : IRequest<ApiResponse<OtpRequestResponseDto>>;

public class ResendVerificationCommandHandler : IRequestHandler<ResendVerificationCommand, ApiResponse<OtpRequestResponseDto>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public ResendVerificationCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<OtpRequestResponseDto>> Handle(ResendVerificationCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        string? debugCode = null;
        if (user != null && !user.EmailVerified)
        {
            var issue = await _otpService.IssueCodeAsync(normalizedEmail, OtpPurposes.VerifyEmail, cancellationToken);
            if (!issue.Success)
            {
                // Cooldown 60s / trần 5 mã/giờ: báo rõ để FE hiển thị đếm ngược
                return ApiResponse<OtpRequestResponseDto>.Fail(issue.ErrorMessage!);
            }
            debugCode = issue.DebugCode;
        }

        // Trả Ok generic trong mọi trường hợp còn lại (không lộ email có tồn tại hay không)
        return ApiResponse<OtpRequestResponseDto>.Ok(
            new OtpRequestResponseDto(debugCode),
            "Nếu email hợp lệ, mã xác thực mới đã được gửi.");
    }
}

// ==========================================
// Quên mật khẩu (Luồng 5, bản chốt v3)
// ==========================================

public record ForgotPasswordCommand(string Email) : IRequest<ApiResponse<OtpRequestResponseDto>>;

public class ForgotPasswordCommandHandler : IRequestHandler<ForgotPasswordCommand, ApiResponse<OtpRequestResponseDto>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public ForgotPasswordCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<OtpRequestResponseDto>> Handle(ForgotPasswordCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        string? debugCode = null;
        if (user != null)
        {
            var issue = await _otpService.IssueCodeAsync(normalizedEmail, OtpPurposes.ResetPassword, cancellationToken);
            if (issue.Success)
            {
                debugCode = issue.DebugCode;
            }
            // Nếu bị cooldown/trần giờ: vẫn trả Ok generic như thường, chỉ là không có mã mới được gửi
        }

        // LUÔN trả Ok với cùng một câu thông báo, kể cả email không tồn tại (chống dò tài khoản)
        return ApiResponse<OtpRequestResponseDto>.Ok(
            new OtpRequestResponseDto(debugCode),
            "Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.");
    }
}

public record ResetPasswordCommand(string Email, string Code, string NewPassword) : IRequest<ApiResponse<string>>;

public class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand, ApiResponse<string>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public ResetPasswordCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<string>> Handle(ResetPasswordCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);
        if (user == null)
        {
            return ApiResponse<string>.Fail("Mã xác nhận đã hết hạn. Vui lòng gửi lại mã mới.");
        }

        // Kiểm tra OTP trước nhưng CHƯA đánh dấu đã dùng: chỉ consume khi mọi validate khác đều đạt,
        // để người dùng không mất mã oan khi mật khẩu mới chưa hợp lệ.
        var verify = await _otpService.VerifyCodeAsync(normalizedEmail, OtpPurposes.ResetPassword, request.Code, consume: false, cancellationToken);
        if (!verify.Success)
        {
            return ApiResponse<string>.Fail(verify.ErrorMessage!);
        }

        var passwordError = PasswordPolicy.Validate(request.NewPassword);
        if (passwordError != null)
        {
            return ApiResponse<string>.Fail(passwordError);
        }

        if (BCrypt.Net.BCrypt.Verify(request.NewPassword, user.PasswordHash))
        {
            return ApiResponse<string>.Fail("Mật khẩu mới không được trùng với mật khẩu cũ.");
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        // Chủ tài khoản đã chứng minh quyền sở hữu qua OTP → xóa trạng thái khóa mềm nếu có
        user.FailedLoginCount = 0;
        user.FailedLoginWindowStart = null;
        user.LockedUntil = null;

        // Hủy mọi phiên đăng nhập cũ của user
        var sessions = await _context.UserSessions.Where(s => s.UserId == user.Id).ToListAsync(cancellationToken);
        _context.UserSessions.RemoveRange(sessions);

        await _context.SaveChangesAsync(cancellationToken);
        await _otpService.MarkUsedAsync(verify.OtpCodeId!.Value, cancellationToken);

        return ApiResponse<string>.Ok("Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.");
    }
}

// ==========================================
// Đăng nhập bằng OTP (lối thoát khi bị khóa mềm / quên mật khẩu)
// ==========================================

public record OtpLoginRequestCommand(string Email) : IRequest<ApiResponse<OtpRequestResponseDto>>;

public class OtpLoginRequestCommandHandler : IRequestHandler<OtpLoginRequestCommand, ApiResponse<OtpRequestResponseDto>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public OtpLoginRequestCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<OtpRequestResponseDto>> Handle(OtpLoginRequestCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        string? debugCode = null;
        if (user != null)
        {
            var issue = await _otpService.IssueCodeAsync(normalizedEmail, OtpPurposes.OtpLogin, cancellationToken);
            if (issue.Success)
            {
                debugCode = issue.DebugCode;
            }
        }

        return ApiResponse<OtpRequestResponseDto>.Ok(
            new OtpRequestResponseDto(debugCode),
            "Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi đến email của bạn.");
    }
}

public record OtpLoginVerifyCommand(string Email, string Code) : IRequest<ApiResponse<UserDto>>;

public class OtpLoginVerifyCommandHandler : IRequestHandler<OtpLoginVerifyCommand, ApiResponse<UserDto>>
{
    private readonly AppDbContext _context;
    private readonly IOtpService _otpService;

    public OtpLoginVerifyCommandHandler(AppDbContext context, IOtpService otpService)
    {
        _context = context;
        _otpService = otpService;
    }

    public async Task<ApiResponse<UserDto>> Handle(OtpLoginVerifyCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var verify = await _otpService.VerifyCodeAsync(normalizedEmail, OtpPurposes.OtpLogin, request.Code, consume: true, cancellationToken);
        if (!verify.Success)
        {
            return ApiResponse<UserDto>.Fail(verify.ErrorMessage!);
        }

        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);
        if (user == null)
        {
            return ApiResponse<UserDto>.Fail("Mã xác nhận không đúng. Bạn còn 5 lần thử.");
        }

        // OTP đúng = bằng chứng chủ sở hữu: email coi như đã xác thực,
        // đồng thời mở khóa mềm ngay và reset bộ đếm sai (Luồng 3 bước 5)
        if (!user.EmailVerified)
        {
            user.EmailVerified = true;
            user.EmailVerifiedAt = DateTime.UtcNow;
        }
        user.FailedLoginCount = 0;
        user.FailedLoginWindowStart = null;
        user.LockedUntil = null;
        await _context.SaveChangesAsync(cancellationToken);

        var userDto = await AuthSessionFactory.CreateSessionAsync(_context, user, cancellationToken);
        return ApiResponse<UserDto>.Ok(userDto, "Đăng nhập thành công.");
    }
}
