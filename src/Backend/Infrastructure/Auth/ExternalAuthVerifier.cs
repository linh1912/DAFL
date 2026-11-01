using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DAFL.Backend.Infrastructure.Auth;

/// <summary>Hồ sơ người dùng do nhà cung cấp ngoài (Google/Facebook) trả về sau khi token được xác thực.</summary>
public record ExternalProfile(
    string Provider,
    string ProviderUserId,
    string? Email,
    bool EmailVerified,
    string? FullName,
    string? AvatarUrl);

/// <summary>
/// Xác thực token đăng nhập social với chính nhà cung cấp (Luồng 6 — bản chốt v4).
/// Tách interface để unit test fake được, không gọi mạng thật.
/// </summary>
public interface IExternalAuthVerifier
{
    /// <summary>Xác thực Google id_token (JWT) qua endpoint tokeninfo của Google. Null = token không hợp lệ.</summary>
    Task<ExternalProfile?> VerifyGoogleAsync(string idToken, CancellationToken cancellationToken);

    /// <summary>Xác thực Facebook access_token qua Graph API debug_token + /me. Null = token không hợp lệ.</summary>
    Task<ExternalProfile?> VerifyFacebookAsync(string accessToken, CancellationToken cancellationToken);
}

public class HttpExternalAuthVerifier : IExternalAuthVerifier
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<HttpExternalAuthVerifier> _logger;

    public HttpExternalAuthVerifier(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<HttpExternalAuthVerifier> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<ExternalProfile?> VerifyGoogleAsync(string idToken, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(idToken)) return null;

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + Uri.EscapeDataString(idToken);
            using var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;

            var payload = await response.Content.ReadFromJsonAsync<GoogleTokenInfo>(cancellationToken: cancellationToken);
            if (payload == null || string.IsNullOrEmpty(payload.Sub)) return null;

            // Token phải được cấp cho đúng ứng dụng DAFL (aud = Google Client ID của DAFL) khi đã cấu hình.
            var expectedAudience = _configuration["Social:GoogleClientId"];
            if (!string.IsNullOrWhiteSpace(expectedAudience)
                && !string.Equals(payload.Audience, expectedAudience, StringComparison.Ordinal))
            {
                _logger.LogWarning("Google id_token bị từ chối: aud không khớp Client ID của DAFL.");
                return null;
            }

            // Chỉ chấp nhận nhà phát hành chính thức của Google.
            if (payload.Issuer != "accounts.google.com" && payload.Issuer != "https://accounts.google.com")
            {
                return null;
            }

            return new ExternalProfile(
                SocialProviders.Google,
                payload.Sub,
                payload.Email,
                payload.EmailVerified,
                payload.Name,
                payload.Picture);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Lỗi khi xác thực Google id_token.");
            return null;
        }
    }

    public async Task<ExternalProfile?> VerifyFacebookAsync(string accessToken, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(accessToken)) return null;

        var appId = _configuration["Social:FacebookAppId"];
        var appSecret = _configuration["Social:FacebookAppSecret"];
        if (string.IsNullOrWhiteSpace(appId) || string.IsNullOrWhiteSpace(appSecret)) return null;

        try
        {
            var client = _httpClientFactory.CreateClient();
            var appAccessToken = $"{appId}|{appSecret}";

            // (i) debug_token: token phải hợp lệ và được cấp cho đúng app DAFL
            var debugUrl = "https://graph.facebook.com/debug_token?input_token="
                + Uri.EscapeDataString(accessToken)
                + "&access_token=" + Uri.EscapeDataString(appAccessToken);
            using var debugResponse = await client.GetAsync(debugUrl, cancellationToken);
            if (!debugResponse.IsSuccessStatusCode) return null;

            var debug = await debugResponse.Content.ReadFromJsonAsync<FacebookDebugTokenResponse>(cancellationToken: cancellationToken);
            if (debug?.Data == null || !debug.Data.IsValid) return null;
            if (!string.Equals(debug.Data.AppId, appId, StringComparison.Ordinal)) return null;

            // (ii) /me: lấy hồ sơ người dùng
            var meUrl = "https://graph.facebook.com/me?fields=id,name,email,picture&access_token="
                + Uri.EscapeDataString(accessToken);
            using var meResponse = await client.GetAsync(meUrl, cancellationToken);
            if (!meResponse.IsSuccessStatusCode) return null;

            var me = await meResponse.Content.ReadFromJsonAsync<FacebookMeResponse>(cancellationToken: cancellationToken);
            if (me == null || string.IsNullOrEmpty(me.Id)) return null;

            // Facebook chỉ trả email khi người dùng đã xác thực email đó với Facebook → coi như đã xác thực.
            return new ExternalProfile(
                SocialProviders.Facebook,
                me.Id,
                me.Email,
                EmailVerified: !string.IsNullOrEmpty(me.Email),
                me.Name,
                me.Picture?.Data?.Url);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Lỗi khi xác thực Facebook access_token.");
            return null;
        }
    }

    private sealed class GoogleTokenInfo
    {
        [JsonPropertyName("sub")] public string? Sub { get; set; }
        [JsonPropertyName("aud")] public string? Audience { get; set; }
        [JsonPropertyName("iss")] public string? Issuer { get; set; }
        [JsonPropertyName("email")] public string? Email { get; set; }
        [JsonPropertyName("email_verified")]
        [JsonConverter(typeof(JsonStringBoolConverter))]
        public bool EmailVerified { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("picture")] public string? Picture { get; set; }
    }

    private sealed class FacebookDebugTokenResponse
    {
        [JsonPropertyName("data")] public FacebookDebugTokenData? Data { get; set; }
    }

    private sealed class FacebookDebugTokenData
    {
        [JsonPropertyName("app_id")] public string? AppId { get; set; }
        [JsonPropertyName("is_valid")] public bool IsValid { get; set; }
    }

    private sealed class FacebookMeResponse
    {
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("email")] public string? Email { get; set; }
        [JsonPropertyName("picture")] public FacebookPicture? Picture { get; set; }
    }

    private sealed class FacebookPicture
    {
        [JsonPropertyName("data")] public FacebookPictureData? Data { get; set; }
    }

    private sealed class FacebookPictureData
    {
        [JsonPropertyName("url")] public string? Url { get; set; }
    }

    /// <summary>Google tokeninfo trả email_verified lúc là bool JSON, lúc là chuỗi "true" — chấp nhận cả hai.</summary>
    private sealed class JsonStringBoolConverter : JsonConverter<bool>
    {
        public override bool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            return reader.TokenType switch
            {
                JsonTokenType.True => true,
                JsonTokenType.False => false,
                JsonTokenType.String => bool.TryParse(reader.GetString(), out var b) && b,
                _ => false
            };
        }

        public override void Write(Utf8JsonWriter writer, bool value, JsonSerializerOptions options)
            => writer.WriteBooleanValue(value);
    }
}
