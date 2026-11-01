using System.Security.Cryptography;
using System.Text;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Tests.Features.Auth;
using FluentAssertions;

namespace DAFL.Backend.Tests.Infrastructure.Auth;

/// <summary>
/// Unit tests cho JwtService (JWT HS256 tự triển khai bằng BCL — CN-02: hạn 1 giờ).
/// </summary>
public class JwtServiceTests
{
    private const string TestSecret = "test-secret-key-for-jwt-unit-tests-0123456789";

    private static User CreateUser(Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(),
        Email = "jwt@dafl.vn",
        FullName = "JWT User",
        Role = "Customer"
    };

    /// <summary>
    /// TC-JWT-01: Token tạo ra validate được về đúng userId, hạn dùng đúng 1 giờ (CN-02).
    /// </summary>
    [Fact]
    public void CreateAndValidate_RoundTrip_ReturnsUserId()
    {
        var service = AuthCommandsTests.CreateJwtService(TestSecret);
        var user = CreateUser();

        var token = service.CreateToken(user, out var expiresAt);

        service.ValidateToken(token).Should().Be(user.Id);
        expiresAt.Should().BeCloseTo(DateTime.UtcNow.AddHours(1), TimeSpan.FromMinutes(1));
    }

    /// <summary>
    /// TC-JWT-02: Token hết hạn (exp trong quá khứ, ký đúng secret) → bị từ chối.
    /// </summary>
    [Fact]
    public void ValidateToken_Expired_ReturnsNull()
    {
        var service = AuthCommandsTests.CreateJwtService(TestSecret);
        var expired = CraftToken(TestSecret, Guid.NewGuid(), DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds());

        service.ValidateToken(expired).Should().BeNull();
    }

    /// <summary>
    /// TC-JWT-03: Token bị sửa payload (chữ ký không khớp) → bị từ chối.
    /// </summary>
    [Fact]
    public void ValidateToken_TamperedPayload_ReturnsNull()
    {
        var service = AuthCommandsTests.CreateJwtService(TestSecret);
        var token = service.CreateToken(CreateUser(), out _);
        var parts = token.Split('.');
        var tampered = parts[0] + "." + parts[1].Replace('A', 'B') + "." + parts[2];

        service.ValidateToken(tampered).Should().BeNull();
    }

    /// <summary>
    /// TC-JWT-04: Token ký bằng secret khác → bị từ chối.
    /// </summary>
    [Fact]
    public void ValidateToken_DifferentSecret_ReturnsNull()
    {
        var issuer = AuthCommandsTests.CreateJwtService("secret-cua-he-thong-khac-1234567890");
        var validator = AuthCommandsTests.CreateJwtService(TestSecret);

        var token = issuer.CreateToken(CreateUser(), out _);

        validator.ValidateToken(token).Should().BeNull();
    }

    /// <summary>
    /// TC-JWT-05: Chuỗi rác / rỗng → bị từ chối, không ném exception.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("a.b")]
    [InlineData("a.b.c.d")]
    public void ValidateToken_Garbage_ReturnsNull(string token)
    {
        var service = AuthCommandsTests.CreateJwtService(TestSecret);
        service.ValidateToken(token).Should().BeNull();
    }

    /// <summary>Tự ký một token HS256 giống hệt JwtService (khóa = SHA256(secret)) với exp tùy ý — dùng cho test hết hạn.</summary>
    private static string CraftToken(string secret, Guid userId, long expUnixSeconds)
    {
        static string B64(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var header = B64(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"));
        var payloadJson = $"{{\"sub\":\"{userId}\",\"email\":\"jwt@dafl.vn\",\"name\":\"JWT User\",\"role\":\"Customer\",\"iat\":{expUnixSeconds - 3600},\"exp\":{expUnixSeconds}}}";
        var payload = B64(Encoding.UTF8.GetBytes(payloadJson));
        var signingInput = $"{header}.{payload}";
        var key = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        using var hmac = new HMACSHA256(key);
        var signature = B64(hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput)));
        return $"{signingInput}.{signature}";
    }
}
