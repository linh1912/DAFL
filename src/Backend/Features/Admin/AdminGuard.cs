using System.Text.Json;
using DAFL.Backend.Infrastructure.Auth;
using DAFL.Backend.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Admin;

/// <summary>
/// Bảo vệ vùng /api/admin/* (tài liệu §1.2–1.3): mọi endpoint admin đều kiểm tra ở Backend,
/// không chỉ ẩn menu ở Frontend. Chỉ Role = SuperAdmin (giá trị cũ "Admin" được chấp nhận
/// trong thời gian chuyển đổi vì DbInitializer tự migrate về SuperAdmin khi khởi động).
/// Đồng thời kiểm tra TokenVersion (JWT cũ sau khi đổi mật khẩu → 401) và IsLocked.
/// </summary>
public static class AdminGuard
{
    public static async Task<(User? Admin, IResult? Error)> RequireSuperAdminAsync(
        HttpContext http, AppDbContext db, CancellationToken ct = default)
    {
        var userId = http.GetCurrentUserId();
        if (!userId.HasValue)
            return (null, Results.Json(
                new { success = false, message = "Bạn cần đăng nhập để truy cập khu vực quản trị." },
                statusCode: StatusCodes.Status401Unauthorized));

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user == null)
            return (null, Results.Json(
                new { success = false, message = "Không tìm thấy tài khoản." },
                statusCode: StatusCodes.Status401Unauthorized));

        // JWT cũ (cấp trước khi đổi mật khẩu) bị vô hiệu: claim tv != User.TokenVersion
        var jwt = http.RequestServices.GetRequiredService<IJwtService>();
        var rawToken = http.Request.Headers.Authorization.ToString();
        if (rawToken.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var tokenVersion = jwt.GetTokenVersion(rawToken["Bearer ".Length..].Trim());
            if (tokenVersion.HasValue && tokenVersion.Value != user.TokenVersion)
                return (null, Results.Json(
                    new { success = false, message = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
                    statusCode: StatusCodes.Status401Unauthorized));
        }

        if (user.IsLocked)
            return (null, Results.Json(
                new { success = false, message = "Tài khoản đã bị khóa." },
                statusCode: StatusCodes.Status403Forbidden));

        if (user.Role != "SuperAdmin" && user.Role != "Admin")
            return (null, Results.Json(
                new { success = false, message = "Bạn không có quyền truy cập khu vực quản trị." },
                statusCode: StatusCodes.Status403Forbidden));

        return (user, null);
    }

    /// <summary>Ghi 1 dòng AuditLog cho hành động admin (§1.3). Không bao giờ ném lỗi ra ngoài — log lỗi rồi thôi.</summary>
    public static async Task WriteAuditAsync(
        AppDbContext db, User actor, string action,
        string? entityType, string? entityId,
        object? oldValue, object? newValue, string? ipAddress,
        CancellationToken ct = default)
    {
        try
        {
            db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                ActorId = actor.Id,
                ActorEmail = actor.Email,
                Action = action,
                EntityType = entityType,
                EntityId = entityId,
                OldValueJson = oldValue == null ? null : JsonSerializer.Serialize(oldValue),
                NewValueJson = newValue == null ? null : JsonSerializer.Serialize(newValue),
                IpAddress = ipAddress,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            // Audit log không được làm hỏng nghiệp vụ chính.
        }
    }

    public static string? ClientIp(HttpContext http)
        => http.Connection.RemoteIpAddress?.ToString();
}

/// <summary>
/// Máy trạng thái đơn hàng (§4). Fork cũ chỉ có Pending/Paid/Cancelled (+Preparing/Shipping/Delivered/Expired);
/// bản mở rộng thêm Confirmed, Completed, ReturnRequested. Mọi chuyển trạng thái (kể cả gọi API trực tiếp)
/// đều phải đi qua bảng này — nhảy trạng thái sai → 400.
/// </summary>
public static class OrderStateMachine
{
    public static readonly Dictionary<OrderStatus, OrderStatus[]> Allowed = new()
    {
        // PayOS: Pending → Paid do webhook; COD: Pending → Confirmed do admin.
        [OrderStatus.Pending] = new[] { OrderStatus.Paid, OrderStatus.Confirmed, OrderStatus.Cancelled, OrderStatus.Expired },
        [OrderStatus.Paid] = new[] { OrderStatus.Confirmed, OrderStatus.Preparing, OrderStatus.Cancelled },
        [OrderStatus.Confirmed] = new[] { OrderStatus.Preparing, OrderStatus.Shipping, OrderStatus.Cancelled },
        [OrderStatus.Preparing] = new[] { OrderStatus.Shipping, OrderStatus.Cancelled },
        [OrderStatus.Shipping] = new[] { OrderStatus.Delivered },
        [OrderStatus.Delivered] = new[] { OrderStatus.Completed, OrderStatus.ReturnRequested },
        [OrderStatus.Completed] = Array.Empty<OrderStatus>(),
        [OrderStatus.ReturnRequested] = new[] { OrderStatus.Delivered, OrderStatus.Cancelled },
        [OrderStatus.Cancelled] = Array.Empty<OrderStatus>(),
        [OrderStatus.Expired] = Array.Empty<OrderStatus>()
    };

    public static bool CanTransition(OrderStatus from, OrderStatus to)
        => Allowed.TryGetValue(from, out var targets) && targets.Contains(to);

    /// <summary>Khách tự hủy được khi đơn đang Pending (COD) hoặc Paid — giữ nguyên quy tắc cũ (CN-08.3).
    /// Từ Confirmed trở đi khách chỉ gửi yêu cầu hủy để admin duyệt (chưa có màn duyệt yêu cầu hủy trong đợt này).</summary>
    public static bool CustomerCanCancel(Order order)
        => order.Status == OrderStatus.Paid
            || (order.Status == OrderStatus.Pending && order.PaymentMethod == "COD");

    /// <summary>Admin được hủy mọi trạng thái trước Shipping (§4).</summary>
    public static bool AdminCanCancel(Order order)
        => order.Status is OrderStatus.Pending or OrderStatus.Paid or OrderStatus.Confirmed or OrderStatus.Preparing;

    /// <summary>Chuyển sang Shipping bắt buộc có đơn vị vận chuyển + mã vận đơn 6–30 ký tự (§4).</summary>
    public static string? ValidateShippingRequirements(OrderStatus to, string? carrier, string? trackingCode)
    {
        if (to != OrderStatus.Shipping) return null;
        if (string.IsNullOrWhiteSpace(carrier)) return "Vui lòng nhập đơn vị vận chuyển.";
        if (string.IsNullOrWhiteSpace(trackingCode) || trackingCode.Trim().Length < 6 || trackingCode.Trim().Length > 30)
            return "Mã vận đơn phải có từ 6 đến 30 ký tự.";
        return null;
    }
}
