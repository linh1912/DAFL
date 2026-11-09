using System.Net;
using System.Net.Mail;

namespace DAFL.Backend.Infrastructure.Email;

/// <summary>
/// Gửi email qua SMTP (đợt 13, mục 1 — quên mật khẩu §9.1 + mail cảnh báo đổi mật khẩu admin).
/// Cấu hình qua IConfiguration (section "Smtp"), map từ biến môi trường SMTP_* trong .env
/// qua docker-compose (Smtp__Host, Smtp__Port, Smtp__Username, Smtp__Password, Smtp__From,
/// Smtp__EnableSsl). Không hard-code host/tài khoản/mật khẩu.
/// Chưa cấu hình đủ 4 giá trị bắt buộc (Host, Username, Password, From) → IsConfigured = false
/// và SendAsync trả false để caller giữ hành vi dự phòng (ghi log ở Development).
/// </summary>
public interface IEmailSender
{
    /// <summary>True khi đã cấu hình đủ để gửi mail thật.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Gửi 1 email HTML. Trả false (không throw) khi chưa cấu hình hoặc SMTP lỗi,
    /// để luồng quên mật khẩu vẫn trả câu chung chống dò tài khoản.
    /// </summary>
    Task<bool> SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default);
}

public class SmtpEmailSender : IEmailSender
{
    private readonly string? _host;
    private readonly int _port;
    private readonly string? _username;
    private readonly string? _password;
    private readonly string? _from;
    private readonly bool _enableSsl;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IConfiguration configuration, ILogger<SmtpEmailSender> logger)
    {
        _logger = logger;
        _host = configuration["Smtp:Host"];
        _port = configuration.GetValue<int>("Smtp:Port", 587);
        _username = configuration["Smtp:Username"];
        _password = configuration["Smtp:Password"];
        _from = configuration["Smtp:From"];
        _enableSsl = configuration.GetValue<bool>("Smtp:EnableSsl", true);
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_host) &&
        !string.IsNullOrWhiteSpace(_username) &&
        !string.IsNullOrWhiteSpace(_password) &&
        !string.IsNullOrWhiteSpace(_from);

    public async Task<bool> SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        if (!IsConfigured) return false;
        try
        {
            using var message = new MailMessage
            {
                From = new MailAddress(_from!),
                Subject = subject,
                Body = htmlBody,
                IsBodyHtml = true,
            };
            message.To.Add(new MailAddress(to));
            using var client = new SmtpClient(_host!, _port)
            {
                EnableSsl = _enableSsl,
                Credentials = new NetworkCredential(_username, _password),
            };
            await client.SendMailAsync(message, ct);
            return true;
        }
        catch (Exception ex)
        {
            // Không throw: lỗi SMTP không được làm lộ mã hay làm fail request quên mật khẩu.
            _logger.LogError(ex, "Failed to send email to {Email} via SMTP {Host}:{Port}", to, _host, _port);
            return false;
        }
    }
}
