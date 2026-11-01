using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DAFL.Backend.Infrastructure.Auth;

/// <summary>
/// JWT HS256 hạn 1 giờ (CN-02), triển khai thủ công bằng BCL (offline feed không có package JwtBearer).
/// Secret đọc từ config "Jwt:Secret" (biến môi trường JWT_SECRET qua file .env).
/// Token mang claims: sub (userId), email, name, role, iat, exp.
/// </summary>
public interface IJwtService
{
    /// <summary>Tạo token cho user; trả kèm thời điểm hết hạn (UTC).</summary>
    string CreateToken(User user, out DateTime expiresAt);

    /// <summary>Kiểm tra chữ ký + hạn dùng. Hợp lệ → trả userId (claim sub), ngược lại null.</summary>
    Guid? ValidateToken(string? token);
}

public class JwtService : IJwtService
{
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(1);

    private readonly byte[] _key;
    private readonly ILogger<JwtService> _logger;

    public JwtService(IConfiguration configuration, ILogger<JwtService> logger)
    {
        _logger = logger;
        var secret = configuration["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            secret = "dafl-dev-only-secret-please-set-JWT_SECRET-env";
            _logger.LogWarning("Jwt:Secret chưa được cấu hình — đang dùng secret mặc định cho môi trường dev. Hãy đặt JWT_SECRET trong file .env khi triển khai thật.");
        }

        // Băm secret về đúng 32 byte làm khóa HMAC-SHA256 (đủ dài bất kể secret ngắn/dài)
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
    }

    public string CreateToken(User user, out DateTime expiresAt)
    {
        var now = DateTime.UtcNow;
        expiresAt = now.Add(TokenLifetime);

        var headerJson = JsonSerializer.Serialize(new { alg = "HS256", typ = "JWT" });
        var payloadJson = JsonSerializer.Serialize(new
        {
            sub = user.Id.ToString(),
            email = user.Email,
            name = user.FullName,
            role = user.Role,
            iat = new DateTimeOffset(now).ToUnixTimeSeconds(),
            exp = new DateTimeOffset(expiresAt).ToUnixTimeSeconds()
        });

        var signingInput = $"{Base64UrlEncode(Encoding.UTF8.GetBytes(headerJson))}.{Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson))}";
        var signature = Sign(signingInput);
        return $"{signingInput}.{Base64UrlEncode(signature)}";
    }

    public Guid? ValidateToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var parts = token.Split('.');
        if (parts.Length != 3) return null;

        var signingInput = $"{parts[0]}.{parts[1]}";
        var expectedSignature = Sign(signingInput);
        byte[] providedSignature;
        try
        {
            providedSignature = Base64UrlDecode(parts[2]);
        }
        catch
        {
            return null;
        }

        if (!CryptographicOperations.FixedTimeEquals(expectedSignature, providedSignature))
        {
            return null;
        }

        try
        {
            var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
            using var doc = JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;

            if (!root.TryGetProperty("exp", out var expElement)
                || DateTimeOffset.FromUnixTimeSeconds(expElement.GetInt64()) <= DateTimeOffset.UtcNow)
            {
                return null; // hết hạn (CN-02 E3: client nhận biết qua 401 → "Phiên đăng nhập đã hết hạn")
            }

            if (root.TryGetProperty("sub", out var subElement)
                && Guid.TryParse(subElement.GetString(), out var userId))
            {
                return userId;
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private byte[] Sign(string signingInput)
    {
        using var hmac = new HMACSHA256(_key);
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput));
    }

    private static string Base64UrlEncode(byte[] data)
        => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        switch (base64.Length % 4)
        {
            case 2: base64 += "=="; break;
            case 3: base64 += "="; break;
        }
        return Convert.FromBase64String(base64);
    }
}

/// <summary>Đọc userId của request hiện tại (do JWT middleware ở Program.cs gán vào HttpContext.Items).</summary>
public static class HttpContextAuthExtensions
{
    public const string CurrentUserIdItemKey = "CurrentUserId";

    public static Guid? GetCurrentUserId(this HttpContext context)
        => context.Items.TryGetValue(CurrentUserIdItemKey, out var value) && value is Guid userId
            ? userId
            : null;
}
