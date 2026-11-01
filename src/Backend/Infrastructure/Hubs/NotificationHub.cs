using DAFL.Backend.Infrastructure.Auth;
using Microsoft.AspNetCore.SignalR;

namespace DAFL.Backend.Infrastructure.Hubs;

public interface INotificationClient
{
    Task ReceiveNotification(object notification);
    Task ReceiveOrderStatusUpdate(long orderCode, string status, string message);
    Task ReceiveCartUpdated(object cartData);
}

public static class NotificationGroups
{
    public static string ForUser(Guid userId) => $"user_{userId}";
}

public class NotificationHub : Hub<INotificationClient>
{
    private readonly ILogger<NotificationHub> _logger;
    private readonly IJwtService _jwtService;

    public NotificationHub(ILogger<NotificationHub> logger, IJwtService jwtService)
    {
        _logger = logger;
        _jwtService = jwtService;
    }

    public override async Task OnConnectedAsync()
    {
        _logger.LogInformation("SignalR client connected: {ConnectionId}", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("SignalR client disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Tham gia nhóm thông báo riêng của người dùng. Phải xuất trình JWT còn hiệu lực (CN-02)
    /// — userId được trích từ claim sub đã kiểm chữ ký, không nhận userId tùy ý từ client
    /// để tránh nghe lén thông báo của người khác.
    /// </summary>
    public async Task<bool> JoinUserGroup(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;

        var userId = _jwtService.ValidateToken(token);
        if (userId == null)
        {
            _logger.LogWarning("Connection {ConnectionId} tried to join a user group with an invalid token", Context.ConnectionId);
            return false;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, NotificationGroups.ForUser(userId.Value));
        _logger.LogInformation("Connection {ConnectionId} joined user group {Group}", Context.ConnectionId, NotificationGroups.ForUser(userId.Value));
        return true;
    }

    public async Task LeaveUserGroup(string userId)
    {
        if (!string.IsNullOrEmpty(userId))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"user_{userId}");
        }
    }
}
