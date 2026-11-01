using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace DAFL.Backend.Tests.Features.Auth;

/// <summary>
/// Unit tests cho NotificationHub: chỉ cho tham gia nhóm thông báo riêng khi JWT hợp lệ (CN-02).
/// </summary>
public class NotificationHubTests
{
    private readonly Mock<IGroupManager> _groups = new();

    private NotificationHub CreateHub()
    {
        var callerContext = new Mock<HubCallerContext>();
        callerContext.Setup(c => c.ConnectionId).Returns("conn-1");
        _groups.Setup(g => g.AddToGroupAsync("conn-1", It.IsAny<string>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        return new NotificationHub(NullLogger<NotificationHub>.Instance, AuthCommandsTests.CreateJwtService())
        {
            Context = callerContext.Object,
            Groups = _groups.Object
        };
    }

    private static User CreateTestUser() => new()
    {
        Id = TestConstants.TestUserId,
        Email = "test@dafl.vn",
        FullName = "Test User",
        Role = "Customer"
    };

    /// <summary>
    /// TC-HUB-01: JWT hợp lệ → vào nhóm user_{userId} trích từ claim sub.
    /// </summary>
    [Fact]
    public async Task JoinUserGroup_WithValidJwt_JoinsOwnUserGroup()
    {
        var token = AuthCommandsTests.CreateJwtService().CreateToken(CreateTestUser(), out _);

        var joined = await CreateHub().JoinUserGroup(token);

        joined.Should().BeTrue();
        _groups.Verify(g => g.AddToGroupAsync("conn-1", NotificationGroups.ForUser(TestConstants.TestUserId), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>
    /// TC-HUB-02: Token rác, userId trần, chuỗi rỗng, hoặc token ký bằng secret khác → bị từ chối.
    /// </summary>
    [Theory]
    [InlineData("khong-phai-token")]
    [InlineData("11111111-1111-1111-1111-111111111111")]
    [InlineData("")]
    public async Task JoinUserGroup_WithInvalidToken_IsRejected(string token)
    {
        var joined = await CreateHub().JoinUserGroup(token);

        joined.Should().BeFalse();
        _groups.Verify(g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task JoinUserGroup_WithTokenFromDifferentSecret_IsRejected()
    {
        var foreignToken = AuthCommandsTests.CreateJwtService("mot-secret-khac-hoan-toan-987654321").CreateToken(CreateTestUser(), out _);

        var joined = await CreateHub().JoinUserGroup(foreignToken);

        joined.Should().BeFalse();
    }
}
