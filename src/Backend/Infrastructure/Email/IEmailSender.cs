using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DAFL.Backend.Infrastructure.Email;

/// <summary>
/// Abstraction gửi email. Nếu config có Email:SmtpHost thì gửi SMTP thật,
/// ngược lại dùng LogEmailSender (chỉ ghi log) cho môi trường dev/demo.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken = default);
}

/// <summary>
/// Email sender cho dev: không gửi thư thật, chỉ ghi log nội dung (không log mã OTP ở mức Information
/// trên Production — sender này vốn chỉ được đăng ký khi không có cấu hình SMTP).
/// </summary>
public class LogEmailSender : IEmailSender
{
    private readonly ILogger<LogEmailSender> _logger;

    public LogEmailSender(ILogger<LogEmailSender> logger)
    {
        _logger = logger;
    }

    public Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("[Email:Log] To={To} Subject={Subject} Body={Body}", to, subject, body);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Gửi email qua SMTP (Gmail SMTP hoặc nhà cung cấp khác) bằng System.Net.Mail.
/// Cấu hình: Email:SmtpHost, Email:SmtpPort (mặc định 587), Email:SmtpUser,
/// Email:SmtpPassword, Email:From (mặc định = SmtpUser), Email:EnableSsl (mặc định true).
/// </summary>
public class SmtpEmailSender : IEmailSender
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IConfiguration configuration, ILogger<SmtpEmailSender> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken = default)
    {
        var host = _configuration["Email:SmtpHost"];
        if (string.IsNullOrWhiteSpace(host))
        {
            _logger.LogWarning("[Email:Smtp] Email:SmtpHost chưa được cấu hình, bỏ qua gửi mail tới {To}.", to);
            return;
        }

        var port = int.TryParse(_configuration["Email:SmtpPort"], out var p) ? p : 587;
        var user = _configuration["Email:SmtpUser"];
        var password = _configuration["Email:SmtpPassword"];
        var from = _configuration["Email:From"] ?? user ?? "no-reply@dafl.vn";
        var enableSsl = !bool.TryParse(_configuration["Email:EnableSsl"], out var ssl) || ssl;

        using var message = new MailMessage
        {
            From = new MailAddress(from, "DAFL Store"),
            Subject = subject,
            Body = body,
            IsBodyHtml = false
        };
        message.To.Add(to);

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = enableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network
        };
        if (!string.IsNullOrWhiteSpace(user))
        {
            client.Credentials = new NetworkCredential(user, password);
        }

        await client.SendMailAsync(message, cancellationToken);
        _logger.LogInformation("[Email:Smtp] Đã gửi mail '{Subject}' tới {To}.", subject, to);
    }
}
