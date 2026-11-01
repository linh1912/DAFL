using System.Security.Cryptography;
using System.Text;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace DAFL.Backend.Features.Auth;

/// <summary>
/// Kết quả phát hành mã OTP. DebugCode chỉ chứa mã thật khi môi trường cho phép
/// (Development/Testing hoặc Auth:ExposeOtpCode=true) và TUYỆT ĐỐI không có ở Production —
/// đây là cơ chế mock OTP phục vụ kiểm thử Selenium, tương tự mock PayOS.
/// </summary>
public record OtpIssueResult(bool Success, string? ErrorMessage, string? DebugCode);

/// <summary>Kết quả kiểm tra mã OTP. OtpCodeId có giá trị khi mã đúng (để caller đánh dấu đã dùng nếu cần).</summary>
public record OtpVerifyResult(bool Success, string? ErrorMessage, Guid? OtpCodeId);

/// <summary>
/// Service OTP dùng chung cho xác thực email / quên mật khẩu / đăng nhập OTP (Mục 5, bản chốt v3):
/// mã 6 chữ số, hạn 10 phút (email), lưu dạng băm SHA-256, dùng 1 lần,
/// sai 5 lần → vô hiệu, mã mới vô hiệu mã cũ cùng mục đích,
/// gửi lại cách nhau tối thiểu 60 giây, tối đa 5 mã/giờ/định danh.
/// </summary>
public interface IOtpService
{
    Task<OtpIssueResult> IssueCodeAsync(string email, string purpose, CancellationToken cancellationToken = default);
    Task<OtpVerifyResult> VerifyCodeAsync(string email, string purpose, string code, bool consume = true, CancellationToken cancellationToken = default);
    Task MarkUsedAsync(Guid otpCodeId, CancellationToken cancellationToken = default);
}

public class OtpService : IOtpService
{
    public const int CodeLifetimeMinutes = 10;
    public const int MaxAttemptsPerCode = 5;
    public const int ResendCooldownSeconds = 60;
    public const int MaxCodesPerHour = 5;

    private readonly AppDbContext _context;
    private readonly IEmailSender _emailSender;
    private readonly IConfiguration _configuration;
    private readonly IHostEnvironment _environment;

    public OtpService(AppDbContext context, IEmailSender emailSender, IConfiguration configuration, IHostEnvironment environment)
    {
        _context = context;
        _emailSender = emailSender;
        _configuration = configuration;
        _environment = environment;
    }

    /// <summary>
    /// Cơ chế mock OTP phục vụ Selenium (giống mock PayOS): chỉ Development/Testing
    /// hoặc khi bật Auth:ExposeOtpCode=true mới được để lộ mã trong response.
    /// Production thì KHÔNG BAO GIỜ, kể cả khi config bị bật nhầm.
    /// </summary>
    public bool CanExposeDebugCode =>
        !_environment.IsProduction()
        && (_environment.IsDevelopment()
            || _environment.IsEnvironment("Testing")
            || _configuration.GetValue<bool>("Auth:ExposeOtpCode"));

    private static string HashCode(string email, string purpose, string code)
    {
        var raw = $"{email.Trim().ToLowerInvariant()}|{purpose}|{code}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
    }

    public async Task<OtpIssueResult> IssueCodeAsync(string email, string purpose, CancellationToken cancellationToken = default)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;

        var latest = await _context.OtpCodes
            .Where(o => o.Email == normalizedEmail && o.Purpose == purpose)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        // Cooldown 60 giây giữa hai lần gửi (tính theo mã gần nhất cùng định danh + mục đích)
        if (latest != null)
        {
            var elapsedSeconds = (now - latest.CreatedAt).TotalSeconds;
            if (elapsedSeconds < ResendCooldownSeconds)
            {
                var waitSeconds = (int)Math.Ceiling(ResendCooldownSeconds - elapsedSeconds);
                return new OtpIssueResult(false, $"Vui lòng chờ {waitSeconds} giây trước khi gửi lại mã.", null);
            }
        }

        // Trần 5 mã / giờ / định danh + mục đích
        var codesLastHour = await _context.OtpCodes
            .CountAsync(o => o.Email == normalizedEmail && o.Purpose == purpose && o.CreatedAt > now.AddHours(-1), cancellationToken);
        if (codesLastHour >= MaxCodesPerHour)
        {
            return new OtpIssueResult(false, "Bạn đã yêu cầu gửi mã quá 5 lần trong 1 giờ. Vui lòng thử lại sau.", null);
        }

        // Mã mới vô hiệu mọi mã cũ chưa dùng của cùng định danh + mục đích
        var staleCodes = await _context.OtpCodes
            .Where(o => o.Email == normalizedEmail && o.Purpose == purpose && !o.Used)
            .ToListAsync(cancellationToken);
        foreach (var stale in staleCodes)
        {
            stale.Used = true;
        }

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var otp = new OtpCode
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            CodeHash = HashCode(normalizedEmail, purpose, code),
            Purpose = purpose,
            ExpiresAt = now.AddMinutes(CodeLifetimeMinutes),
            Attempts = 0,
            Used = false,
            CreatedAt = now
        };
        await _context.OtpCodes.AddAsync(otp, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);

        var (subject, body) = BuildEmailContent(purpose, code);
        await _emailSender.SendAsync(normalizedEmail, subject, body, cancellationToken);

        return new OtpIssueResult(true, null, CanExposeDebugCode ? code : null);
    }

    public async Task<OtpVerifyResult> VerifyCodeAsync(string email, string purpose, string code, bool consume = true, CancellationToken cancellationToken = default)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;

        var otp = await _context.OtpCodes
            .Where(o => o.Email == normalizedEmail && o.Purpose == purpose)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (otp == null)
        {
            return new OtpVerifyResult(false, "Mã xác nhận đã hết hạn. Vui lòng gửi lại mã mới.", null);
        }

        // Mã đã bị vô hiệu vì nhập sai quá 5 lần (kể cả khi lần này nhập đúng)
        if (otp.Attempts >= MaxAttemptsPerCode)
        {
            return new OtpVerifyResult(false, "Mã đã bị vô hiệu do nhập sai quá 5 lần. Vui lòng gửi lại mã mới.", null);
        }

        // Mã đã dùng / đã bị mã mới thay thế / đã hết hạn
        if (otp.Used || otp.ExpiresAt <= now)
        {
            return new OtpVerifyResult(false, "Mã xác nhận đã hết hạn. Vui lòng gửi lại mã mới.", null);
        }

        if (!string.Equals(otp.CodeHash, HashCode(normalizedEmail, purpose, code?.Trim() ?? string.Empty), StringComparison.Ordinal))
        {
            otp.Attempts++;
            await _context.SaveChangesAsync(cancellationToken);

            if (otp.Attempts >= MaxAttemptsPerCode)
            {
                return new OtpVerifyResult(false, "Mã đã bị vô hiệu do nhập sai quá 5 lần. Vui lòng gửi lại mã mới.", null);
            }

            var remaining = MaxAttemptsPerCode - otp.Attempts;
            return new OtpVerifyResult(false, $"Mã xác nhận không đúng. Bạn còn {remaining} lần thử.", null);
        }

        if (consume)
        {
            otp.Used = true; // Mã chỉ dùng 1 lần
            await _context.SaveChangesAsync(cancellationToken);
        }

        return new OtpVerifyResult(true, null, otp.Id);
    }

    public async Task MarkUsedAsync(Guid otpCodeId, CancellationToken cancellationToken = default)
    {
        var otp = await _context.OtpCodes.FirstOrDefaultAsync(o => o.Id == otpCodeId, cancellationToken);
        if (otp != null && !otp.Used)
        {
            otp.Used = true;
            await _context.SaveChangesAsync(cancellationToken);
        }
    }

    private static (string Subject, string Body) BuildEmailContent(string purpose, string code) => purpose switch
    {
        OtpPurposes.VerifyEmail => (
            "DAFL - Mã xác thực email của bạn",
            $"Xin chào,\n\nMã xác thực email cho tài khoản DAFL của bạn là: {code}\nMã có hiệu lực trong {CodeLifetimeMinutes} phút và chỉ dùng 1 lần.\n\nNếu bạn không thực hiện đăng ký, vui lòng bỏ qua email này.\n\nDAFL Store"),
        OtpPurposes.ResetPassword => (
            "DAFL - Mã đặt lại mật khẩu",
            $"Xin chào,\n\nMã xác nhận để đặt lại mật khẩu DAFL của bạn là: {code}\nMã có hiệu lực trong {CodeLifetimeMinutes} phút và chỉ dùng 1 lần.\n\nNếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.\n\nDAFL Store"),
        OtpPurposes.OtpLogin => (
            "DAFL - Mã đăng nhập của bạn",
            $"Xin chào,\n\nMã đăng nhập DAFL của bạn là: {code}\nMã có hiệu lực trong {CodeLifetimeMinutes} phút và chỉ dùng 1 lần.\n\nNếu bạn không thực hiện đăng nhập, vui lòng bỏ qua email này.\n\nDAFL Store"),
        _ => (
            "DAFL - Mã xác nhận",
            $"Mã xác nhận DAFL của bạn là: {code}\nMã có hiệu lực trong {CodeLifetimeMinutes} phút và chỉ dùng 1 lần.\n\nDAFL Store")
    };
}
