using DAFL.Backend.Common;
using DAFL.Backend.Features.Auth;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Email;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Auth;

/// <summary>
/// Quên / đặt lại mật khẩu (§9.1).
/// Luôn trả cùng 1 câu dù email có tồn tại hay không (chống dò tài khoản).
/// Mã 6 số được BĂM (BCrypt) trước khi lưu, hạn 15 phút, tối đa 5 lần nhập sai, tối đa 3 lần gửi lại / 1 giờ / email.
/// GỬI MAIL: mã được gửi bằng email thật qua IEmailSender (SMTP, cấu hình SMTP_* trong .env);
/// CHỈ khi SMTP chưa cấu hình đủ thì mới ghi mã ra log ở môi trường Development để kiểm thử.
/// </summary>
public record ForgotPasswordCommand(string Email) : IRequest<ApiResponse<string>>;

public class ForgotPasswordCommandValidator : AbstractValidator<ForgotPasswordCommand>
{
    public ForgotPasswordCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().WithMessage("Email không hợp lệ.");
    }
}

public class ForgotPasswordCommandHandler : IRequestHandler<ForgotPasswordCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    private readonly ILogger<ForgotPasswordCommandHandler> _logger;
    private readonly IHostEnvironment _env;
    private readonly IEmailSender _emailSender;

    public ForgotPasswordCommandHandler(AppDbContext db, ILogger<ForgotPasswordCommandHandler> logger, IHostEnvironment env, IEmailSender emailSender)
    {
        _db = db;
        _logger = logger;
        _env = env;
        _emailSender = emailSender;
    }

    public async Task<ApiResponse<string>> Handle(ForgotPasswordCommand request, CancellationToken ct)
    {
        const string genericMessage = "Nếu email tồn tại, mã đặt lại đã được gửi.";
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user == null) return ApiResponse<string>.Ok(genericMessage);

        // Tối đa 3 lần gửi lại trong 1 giờ / email.
        var oneHourAgo = DateTime.UtcNow.AddHours(-1);
        var recentCount = await _db.PasswordResetCodes.CountAsync(c => c.UserId == user.Id && c.CreatedAt >= oneHourAgo, ct);
        if (recentCount >= 3) return ApiResponse<string>.Ok(genericMessage);

        // Hủy các mã chưa dùng trước đó của tài khoản.
        var oldCodes = await _db.PasswordResetCodes.Where(c => c.UserId == user.Id && !c.IsUsed).ToListAsync(ct);
        foreach (var old in oldCodes) old.IsUsed = true;

        var code = new Random().Next(100000, 999999).ToString();
        _db.PasswordResetCodes.Add(new PasswordResetCode
        {
            Id = Guid.NewGuid(), UserId = user.Id,
            CodeHash = BCrypt.Net.BCrypt.HashPassword(code),
            ExpiresAt = DateTime.UtcNow.AddMinutes(15),
            FailedAttempts = 0, IsUsed = false, CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);

        // Đợt 13, mục 1: gửi mã bằng EMAIL THẬT khi SMTP đã cấu hình đủ (SMTP_* trong .env).
        // Chưa cấu hình → giữ hành vi cũ: chỉ ghi mã ra log ở Development để kiểm thử.
        // Lỗi gửi mail không được làm lộ mã hay fail request (luôn trả câu chung chống dò tài khoản).
        if (_emailSender.IsConfigured)
        {
            var sent = await _emailSender.SendAsync(email, "DAFL — Mã đặt lại mật khẩu của bạn",
                $"""
                <p>Xin chào,</p>
                <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản DAFL. Mã đặt lại của bạn là:</p>
                <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">{code}</p>
                <p>Mã có hiệu lực trong <b>15 phút</b> và chỉ dùng được một lần. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
                <p>Trân trọng,<br/>Đội ngũ DAFL</p>
                """, ct);
            if (sent)
            {
                _logger.LogInformation("Password reset code emailed to {Email}.", email);
            }
            else if (_env.IsDevelopment())
            {
                // SMTP cấu hình nhưng gửi lỗi (sai mật khẩu/mạng...): ghi mã ra log ở dev để vẫn kiểm thử được.
                _logger.LogWarning("[DEV-ONLY] Password reset email failed for {Email}; code: {Code} (expires in 15 minutes)", email, code);
            }
            else
            {
                _logger.LogWarning("Password reset email failed for {Email}. Check SMTP configuration.", email);
            }
        }
        else if (_env.IsDevelopment())
        {
            // CHỈ Development và CHỈ khi SMTP chưa cấu hình: ghi mã ra log để kiểm thử.
            _logger.LogWarning("[DEV-ONLY] Password reset code for {Email}: {Code} (expires in 15 minutes). SMTP is not configured — set SMTP_* in .env to send real emails.", email, code);
        }
        else
        {
            _logger.LogInformation("Password reset code issued for {Email}. SMTP is not configured — set SMTP_* in .env to send real emails.", email);
        }
        return ApiResponse<string>.Ok(genericMessage);
    }
}

public record ResetPasswordCommand(string Email, string Code, string NewPassword, string? ConfirmNewPassword)
    : IRequest<ApiResponse<string>>;

public class ResetPasswordCommandValidator : AbstractValidator<ResetPasswordCommand>
{
    public ResetPasswordCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().WithMessage("Email không hợp lệ.");
        RuleFor(x => x.Code).NotEmpty().Matches(@"^\d{6}$").WithMessage("Mã đặt lại gồm 6 chữ số.");
        RuleFor(x => x.NewPassword).NotEmpty().WithMessage("Mật khẩu mới không được để trống.");
    }
}

public class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand, ApiResponse<string>>
{
    private readonly AppDbContext _db;
    public ResetPasswordCommandHandler(AppDbContext db) => _db = db;

    public async Task<ApiResponse<string>> Handle(ResetPasswordCommand request, CancellationToken ct)
    {
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        // Không lộ việc email có tồn tại hay không — mọi lỗi đều trả câu chung.
        const string genericError = "Mã đặt lại không đúng hoặc đã hết hạn.";
        if (user == null) return ApiResponse<string>.Fail(genericError);

        var record = await _db.PasswordResetCodes
            .Where(c => c.UserId == user.Id && !c.IsUsed && c.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(ct);
        if (record == null) return ApiResponse<string>.Fail(genericError);

        if (record.FailedAttempts >= 5)
        {
            record.IsUsed = true;
            await _db.SaveChangesAsync(ct);
            return ApiResponse<string>.Fail("Bạn đã nhập sai quá 5 lần. Mã đã bị hủy, vui lòng xin mã mới.");
        }

        if (!BCrypt.Net.BCrypt.Verify(request.Code ?? string.Empty, record.CodeHash))
        {
            record.FailedAttempts++;
            if (record.FailedAttempts >= 5) record.IsUsed = true;
            await _db.SaveChangesAsync(ct);
            return ApiResponse<string>.Fail(genericError);
        }

        if (PasswordPolicy.Validate(request.NewPassword) is { } passwordError)
            return ApiResponse<string>.Fail(passwordError);
        if (!string.IsNullOrEmpty(user.PasswordHash) && BCrypt.Net.BCrypt.Verify(request.NewPassword, user.PasswordHash))
            return ApiResponse<string>.Fail("Mật khẩu mới không được trùng với mật khẩu cũ.");
        if (!string.IsNullOrEmpty(request.ConfirmNewPassword) && request.ConfirmNewPassword != request.NewPassword)
            return ApiResponse<string>.Fail("Mật khẩu xác nhận không khớp");

        record.IsUsed = true;
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.TokenVersion++; // hủy mọi JWT đang sống
        await _db.SaveChangesAsync(ct);
        return ApiResponse<string>.Ok("Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.");
    }
}
