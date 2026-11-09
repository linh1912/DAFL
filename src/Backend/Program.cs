using DAFL.Backend.Common;
using DAFL.Backend.Common.Behaviors;
using DAFL.Backend.Features.Admin;
using DAFL.Backend.Features.Auth;
using DAFL.Backend.Features.Membership;
using DAFL.Backend.Features.Promotions;
using DAFL.Backend.Features.Addresses;
using DAFL.Backend.Features.Cart;
using DAFL.Backend.Features.Categories.GetCategories;
using DAFL.Backend.Features.Orders;
using DAFL.Backend.Features.Orders.Checkout;
using DAFL.Backend.Features.Orders.CancelOrder;
using DAFL.Backend.Features.Orders.GetOrderDetail;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Features.Payments.GetPaymentStatus;
using DAFL.Backend.Features.Payments.PayOSWebhook;
using DAFL.Backend.Features.Products;
using DAFL.Backend.Features.Products.ListProducts;
using DAFL.Backend.Features.Vouchers;
using DAFL.Backend.Infrastructure.Auth;
using DAFL.Backend.Infrastructure.Caching;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Email;
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Infrastructure.Payments;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.OpenApi.Models;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// 1. Add Services to the container
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "DAFL Store API",
        Version = "v1",
        Description = "API backend cho ứng dụng thương mại điện tử DAFL Store. "
            + "Bao gồm các module: Xác thực (Auth), Sản phẩm (Products), Giỏ hàng (Cart), "
            + "Đơn hàng (Orders), Thanh toán (Payments), Mã giảm giá (Vouchers), "
            + "Thông báo (Notifications), và Danh mục (Categories).",
        Contact = new OpenApiContact { Name = "DAFL Team", Email = "dev@dafl.vn" }
    });

    // Nhóm các endpoint theo tag (module)
    options.TagActionsBy(api =>
    {
        if (api.RelativePath == null) return new[] { "Health" };
        if (api.RelativePath.StartsWith("api/auth")) return new[] { "Auth - Xác thực" };
        if (api.RelativePath.StartsWith("api/notifications")) return new[] { "Notifications - Thông báo" };
        if (api.RelativePath.StartsWith("api/categories")) return new[] { "Categories - Danh mục" };
        if (api.RelativePath.StartsWith("api/products")) return new[] { "Products - Sản phẩm" };
        if (api.RelativePath.StartsWith("api/cart")) return new[] { "Cart - Giỏ hàng" };
        if (api.RelativePath.StartsWith("api/vouchers")) return new[] { "Vouchers - Mã giảm giá" };
        if (api.RelativePath.StartsWith("api/orders")) return new[] { "Orders - Đơn hàng" };
        if (api.RelativePath.StartsWith("api/payments")) return new[] { "Payments - Thanh toán" };
        if (api.RelativePath.StartsWith("api/admin")) return new[] { "Admin - Quản trị" };
        if (api.RelativePath.StartsWith("api/membership")) return new[] { "Membership - Hội viên" };
        if (api.RelativePath.StartsWith("api/promotions")) return new[] { "Promotions - Khuyến mãi" };
        return new[] { "Other" };
    });
});
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddSignalR();

// 2. Database - PostgreSQL (Lightweight Alpine for demo)
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Port=5432;Database=dafl_db;Username=dafl;Password=dafl_password123;Include Error Detail=true;";

var dbProvider = builder.Configuration["DatabaseProvider"] ?? "PostgreSQL";

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (dbProvider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase) || connectionString.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(connectionString.StartsWith("Data Source=") ? connectionString : "Data Source=dafl_demo.db");
    }
    else
    {
        options.UseNpgsql(connectionString, npgsqlOptions =>
        {
            npgsqlOptions.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(3), errorCodesToAdd: null);
        });
    }
});

// 3. Resilient Caching (In-Memory default, Redis when enabled)
var cacheEnabled = builder.Configuration.GetValue<bool>("CacheSettings:Enabled", false);
var redisConnectionString = builder.Configuration["CacheSettings:ConnectionString"] ?? "localhost:6379,abortConnect=false,connectTimeout=2000";

if (cacheEnabled)
{
    try
    {
        var configOptions = ConfigurationOptions.Parse(redisConnectionString);
        configOptions.AbortOnConnectFail = false;
        configOptions.ConnectTimeout = 2000;
        configOptions.SyncTimeout = 2000;
        var redisConnection = ConnectionMultiplexer.Connect(configOptions);
        builder.Services.AddSingleton<IConnectionMultiplexer>(redisConnection);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Cache Warning] Could not initialize Redis connection at startup: {ex.Message}. Falling back to in-memory.");
    }
}

builder.Services.AddSingleton<ICacheService, ResilientCacheService>();

// 4. MediatR with Pipeline Behaviors
builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssembly(typeof(Program).Assembly);
    cfg.AddBehavior(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
    cfg.AddBehavior(typeof(IPipelineBehavior<,>), typeof(CachingBehavior<,>));
});

// 5. FluentValidation
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);

// 6. Messaging - Kafka (KRaft mode)
builder.Services.AddSingleton<IKafkaProducer, KafkaProducer>();
builder.Services.AddHostedService<KafkaConsumerWorker>();

// 7. PayOS & Stock Reservation Background Worker
builder.Services.AddScoped<IPayOSService, PayOSService>();
builder.Services.AddHostedService<ReservationCleanupWorker>();
// Bảo trì hội viên (§5.2/§5.3): hết hạn điểm 12 tháng + xét lại hạng hằng ngày.
builder.Services.AddHostedService<MembershipMaintenanceWorker>();

// 7b. JWT (CN-02): đăng nhập/đăng ký/social cấp JWT HS256 hạn 1 giờ, secret từ Jwt:Secret (env JWT_SECRET).
// Email sender (đợt 13, mục 1): gửi mã quên mật khẩu qua SMTP (cấu hình SMTP_* trong .env);
// chưa cấu hình đủ thì IEmailSender.IsConfigured = false và handler chỉ ghi mã ra log ở Development.
builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();

// 7c. Social login (Luồng 6 — bản chốt v4): BE tự xác thực token với Google/Facebook qua HttpClient.
// Cấu hình ở section "Social" (GoogleClientId / FacebookAppId / FacebookAppSecret qua biến môi trường file .env).
builder.Services.AddScoped<IExternalAuthVerifier, HttpExternalAuthVerifier>();

// 8. CORS configuration for React SPA + SignalR
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:3000", "http://localhost:5173", "http://localhost:80", "http://localhost")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "DAFL Store API v1");
        options.DocumentTitle = "DAFL Store API Documentation";
    });
}

app.UseCors("AllowFrontend");

// Serve ảnh đã upload (đợt redesign form admin): GET /uploads/<file> trỏ tới
// thư mục "uploads" dưới thư mục chạy của backend (trong container là /app/uploads,
// được giữ lại qua volume uploads_data trong docker-compose.yml).
// Đặt trước middleware JWT: ảnh sản phẩm là public, không cần đăng nhập, không chạm DB.
var uploadsRoot = UploadImageHelper.GetUploadsRoot();
Directory.CreateDirectory(uploadsRoot);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadsRoot),
    RequestPath = "/uploads"
});

// JWT authentication middleware (CN-02): có header "Authorization: Bearer <token>" hợp lệ
// thì gán userId vào HttpContext.Items["CurrentUserId"] để các endpoint cần đăng nhập đọc qua GetCurrentUserId().
// Token sai/hết hạn → không gán (endpoint bảo vệ tự trả 401; client hiển thị "Phiên đăng nhập đã hết hạn").
app.Use(async (context, next) =>
{
    var authorization = context.Request.Headers.Authorization.ToString();
    if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        var jwtService = context.RequestServices.GetRequiredService<IJwtService>();
        var rawToken = authorization["Bearer ".Length..].Trim();
        var userId = jwtService.ValidateToken(rawToken);
        if (userId.HasValue)
        {
            context.Items[HttpContextAuthExtensions.CurrentUserIdItemKey] = userId.Value;
            var tokenVersion = jwtService.GetTokenVersion(rawToken);
            if (tokenVersion.HasValue)
            {
                context.Items[HttpContextAuthExtensions.CurrentTokenVersionItemKey] = tokenVersion.Value;
            }
            // Vô hiệu JWT cũ sau khi đổi/đặt lại mật khẩu (TokenVersion tăng) và chặn tài khoản bị khóa.
            // Lỗi DB ở đây không chặn request (endpoint cần DB sẽ tự báo lỗi) — chỉ fail-closed khi đọc được user.
            try
            {
                var db = context.RequestServices.GetRequiredService<AppDbContext>();
                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value);
                if (user == null || user.IsLocked || (tokenVersion.HasValue && tokenVersion.Value != user.TokenVersion))
                {
                    context.Items.Remove(HttpContextAuthExtensions.CurrentUserIdItemKey);
                    context.Items.Remove(HttpContextAuthExtensions.CurrentTokenVersionItemKey);
                }
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Auth middleware: could not verify TokenVersion/lock status for user {UserId}.", userId.Value);
            }
        }
    }
    await next();
});

// Global exception handling for validation and runtime errors
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ValidationException valEx)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        context.Response.ContentType = "application/json";
        var errors = valEx.Errors.Select(e => e.ErrorMessage).ToList();
        var response = ApiResponse<string>.Fail("Dữ liệu gửi lên không hợp lệ.", errors);
        await context.Response.WriteAsJsonAsync(response);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/json";
        var response = ApiResponse<string>.Fail("Đã có lỗi hệ thống xảy ra. Vui lòng thử lại sau.");
        await context.Response.WriteAsJsonAsync(response);
    }
});

// ==========================================
// SignalR Hub Endpoint
// ==========================================
app.MapHub<NotificationHub>("/hubs/notifications");

// ==========================================
// Minimal API Endpoints - Tổ chức theo Module
// ==========================================

// Health check
app.MapGet("/health", () => Results.Ok(new { status = "Healthy", database = "PostgreSQL", timestamp = DateTime.UtcNow }))
    .WithName("HealthCheck")
    .WithSummary("Kiểm tra trạng thái hoạt động của hệ thống")
    .WithDescription("Endpoint kiểm tra sức khỏe (health check) của API server. Trả về trạng thái Healthy cùng thông tin database và timestamp hiện tại.")
    .WithTags("Health");

// ==========================================
// MODULE 1: AUTH - Xác thực & Quản lý phiên
// ==========================================

app.MapPost("/api/auth/register", async (RegisterCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Register")
.WithSummary("Đăng ký tài khoản mới (CN-01)")
.WithDescription("Tạo tài khoản với họ tên, email, SĐT (bắt buộc, duy nhất), mật khẩu (policy nghiêm ngặt: ≥ 8 ký tự, chữ hoa, chữ số, ký tự đặc biệt). "
    + "Theo đặc tả CN: KHÔNG có bước OTP/xác thực email — tài khoản dùng ngay, phản hồi kèm JWT hạn 1 giờ.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/login", async (LoginCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Login")
.WithSummary("Đăng nhập vào hệ thống (CN-02)")
.WithDescription("Xác thực bằng email + mật khẩu. Thành công → trả { token, user } với JWT HS256 hạn 1 giờ. "
    + "Sai thông tin → một câu chung \"Email hoặc mật khẩu không đúng\". Client gửi token qua header Authorization: Bearer <token>.")
.WithTags("Auth - Xác thực");

app.MapGet("/api/auth/me", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Ok(ApiResponse<UserDto?>.Ok(null, "Chưa đăng nhập."));
    }

    var user = await dbContext.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value);
    if (user == null)
    {
        return Results.Ok(ApiResponse<UserDto?>.Ok(null, "Chưa đăng nhập."));
    }

    var dto = await AuthTokenFactory.BuildUserDtoAsync(dbContext, user, httpContext.RequestAborted);
    return Results.Ok(ApiResponse<UserDto>.Ok(dto));
})
.WithName("GetCurrentUser")
.WithSummary("Lấy thông tin người dùng hiện tại")
.WithDescription("Đọc JWT (Authorization: Bearer) để xác định người dùng. Trả về user (kèm hasPassword + authProvider) hoặc null nếu chưa đăng nhập/token hết hạn.")
.WithTags("Auth - Xác thực");

app.MapGet("/api/auth/profile", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem hồ sơ."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var user = await dbContext.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value);
    if (user == null)
    {
        return Results.Json(ApiResponse<string>.Fail("Không tìm thấy tài khoản."), statusCode: StatusCodes.Status404NotFound);
    }

    var dto = await AuthTokenFactory.BuildUserDtoAsync(dbContext, user, httpContext.RequestAborted);
    return Results.Ok(ApiResponse<UserDto>.Ok(dto));
})
.WithName("GetProfile")
.WithSummary("Xem hồ sơ cá nhân (CN-03.1)")
.WithDescription("Trả về họ tên, email (chỉ đọc), SĐT của người dùng đang đăng nhập bằng JWT.")
.WithTags("Auth - Xác thực");

app.MapPut("/api/auth/profile", async (UpdateProfileRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để cập nhật thông tin cá nhân."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new UpdateProfileCommand(userId.Value, request.FullName, request.PhoneNumber, request.Address));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateProfile")
.WithSummary("Cập nhật thông tin cá nhân (CN-03.1)")
.WithDescription("Sửa họ tên + SĐT (validate như CN-01; SĐT trùng tài khoản khác → lỗi). Email không sửa được. Cần JWT.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/change-password", async (ChangePasswordRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để đổi mật khẩu."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new ChangePasswordCommand(userId.Value, request.CurrentPassword, request.NewPassword, request.ConfirmNewPassword));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ChangePassword")
.WithSummary("Đổi mật khẩu (CN-03.2)")
.WithDescription("Kiểm tra mật khẩu hiện tại, mật khẩu mới theo policy nghiêm ngặt và phải khác mật khẩu cũ. Cần JWT.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/logout", () =>
{
    // JWT stateless: server không lưu phiên — client tự xóa token (CN-02).
    return Results.Ok(ApiResponse<string>.Ok("Đã đăng xuất thành công."));
})
.WithName("Logout")
.WithSummary("Đăng xuất khỏi hệ thống (CN-02)")
.WithDescription("JWT không lưu phía server nên đăng xuất chỉ là thao tác phía client (xóa token). Endpoint giữ để tương thích luồng FE.")
.WithTags("Auth - Xác thực");

// ==========================================
// MODULE 1B: SOCIAL LOGIN - Google / Facebook (Luồng 6, bản chốt v4)
// FE lấy token từ nhà cung cấp → BE tự xác thực token → tìm/liên kết/tạo tài khoản (L1–L3)
// → cấp JWT 1 giờ giống hệt đăng nhập mật khẩu (CN-02).
// ==========================================

app.MapGet("/api/auth/social/config", (IHostEnvironment env, IConfiguration configuration) =>
{
    return Results.Ok(ApiResponse<SocialConfigDto>.Ok(SocialAuthSettings.BuildConfig(env, configuration)));
})
.WithName("GetSocialConfig")
.WithSummary("Cấu hình đăng nhập mạng xã hội (public)")
.WithDescription("Cho FE biết provider nào đang bật (googleEnabled/facebookEnabled), mock có bật không (mockEnabled — chỉ Development/Testing) "
    + "và ClientId/AppId công khai để khởi tạo SDK phía client. KHÔNG chứa secret.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/social/google", async (SocialGoogleRequest request, HttpContext httpContext, IExternalAuthVerifier verifier, IMediator mediator) =>
{
    var profile = await verifier.VerifyGoogleAsync(request.IdToken, httpContext.RequestAborted);
    if (profile == null)
    {
        return Results.BadRequest(ApiResponse<AuthResultDto>.Fail("Không thể xác thực với Google. Vui lòng thử lại."));
    }

    var result = await mediator.Send(new SocialLoginCommand(profile));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("SocialLoginGoogle")
.WithSummary("Đăng nhập/đăng ký bằng Google")
.WithDescription("Nhận id_token (JWT) từ Google Identity Services ở FE; BE kiểm chữ ký + aud qua tokeninfo của Google, "
    + "sau đó áp quy tắc liên kết L1–L3 và cấp JWT 1 giờ.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/social/facebook", async (SocialFacebookRequest request, HttpContext httpContext, IExternalAuthVerifier verifier, IMediator mediator) =>
{
    var profile = await verifier.VerifyFacebookAsync(request.AccessToken, httpContext.RequestAborted);
    if (profile == null)
    {
        return Results.BadRequest(ApiResponse<AuthResultDto>.Fail("Không thể xác thực với Facebook. Vui lòng thử lại."));
    }

    var result = await mediator.Send(new SocialLoginCommand(profile));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("SocialLoginFacebook")
.WithSummary("Đăng nhập/đăng ký bằng Facebook")
.WithDescription("Nhận access_token từ Facebook JS SDK ở FE; BE kiểm qua Graph API debug_token + /me, "
    + "sau đó áp quy tắc liên kết L1–L3 và cấp JWT 1 giờ.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/social/mock", async (SocialMockRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var result = await mediator.Send(new MockSocialLoginCommand(request.Provider.Trim().ToLowerInvariant()));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("SocialLoginMock")
.WithSummary("Đăng nhập mạng xã hội GIẢ LẬP (chỉ Development/Testing)")
.WithDescription("Cơ chế kiểm thử cho Selenium/demo: đăng nhập bằng 1 user mẫu cố định cho mỗi provider "
    + "(google.test@dafl.vn / facebook.test@dafl.vn). Production tắt cứng.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/set-password", async (SetPasswordRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để đặt mật khẩu."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new SetPasswordCommand(userId.Value, request.NewPassword));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("SetPassword")
.WithSummary("Đặt mật khẩu lần đầu cho tài khoản social")
.WithDescription("Chỉ áp dụng cho tài khoản CHƯA có mật khẩu (tạo qua Google/Facebook). "
    + "Mật khẩu phải thỏa policy nghiêm ngặt chung (≥ 8 ký tự, chữ hoa, chữ số, ký tự đặc biệt). "
    + "Tài khoản đã có mật khẩu sẽ bị từ chối. Cần JWT.")
.WithTags("Auth - Xác thực");

// ==========================================
// MODULE 2: NOTIFICATIONS - Thông báo
// ==========================================

app.MapGet("/api/notifications", async (Guid? userId, IMediator mediator) =>
{
    var result = await mediator.Send(new GetNotificationsQuery(userId));
    return Results.Ok(result);
})
.WithName("GetNotifications")
.WithSummary("Lấy danh sách thông báo của người dùng")
.WithDescription("Trả về tối đa 30 thông báo mới nhất của người dùng, sắp xếp theo thời gian tạo giảm dần. "
    + "Nếu có userId, chỉ trả về thông báo của user đó và thông báo hệ thống (userId = null); nếu không, chỉ trả về thông báo hệ thống.")
.WithTags("Notifications - Thông báo");

app.MapPut("/api/notifications/{id:guid}/read", async (Guid id, IMediator mediator) =>
{
    var result = await mediator.Send(new MarkNotificationReadCommand(id));
    return Results.Ok(result);
})
.WithName("MarkNotificationRead")
.WithSummary("Đánh dấu một thông báo đã đọc")
.WithDescription("Cập nhật trạng thái IsRead = true cho thông báo có ID tương ứng. "
    + "Trả về lỗi nếu không tìm thấy thông báo.")
.WithTags("Notifications - Thông báo");

app.MapPut("/api/notifications/read-all", async (Guid? userId, IMediator mediator) =>
{
    var result = await mediator.Send(new MarkAllNotificationsReadCommand(userId));
    return Results.Ok(result);
})
.WithName("MarkAllNotificationsRead")
.WithSummary("Đánh dấu tất cả thông báo đã đọc")
.WithDescription("Đánh dấu tất cả thông báo chưa đọc của người dùng (theo userId) thành đã đọc. "
    + "Nếu không truyền userId, chỉ đánh dấu các thông báo hệ thống (userId = null).")
.WithTags("Notifications - Thông báo");

app.MapPost("/api/notifications/test", async (SendTestNotificationCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return Results.Ok(result);
})
.WithName("SendTestNotification")
.WithSummary("Gửi thông báo test qua SignalR (chỉ dùng cho dev/demo)")
.WithDescription("Tạo một thông báo mới trong database và phát broadcast real-time qua SignalR đến tất cả client đang kết nối. "
    + "Dùng để kiểm thử chức năng thông báo thời gian thực.")
.WithTags("Notifications - Thông báo");

// ==========================================
// MODULE 3: CATEGORIES - Danh mục sản phẩm
// ==========================================

app.MapGet("/api/categories", async (IMediator mediator) =>
{
    var result = await mediator.Send(new GetCategoriesQuery());
    return Results.Ok(result);
})
.WithName("GetCategories")
.WithSummary("Lấy danh sách tất cả danh mục sản phẩm")
.WithDescription("Trả về toàn bộ danh mục sản phẩm, sắp xếp theo tên alphabet. "
    + "Kết quả được cache trong 1 giờ (Redis/InMemory) để tối ưu hiệu năng.")
.WithTags("Categories - Danh mục");

// ==========================================
// MODULE 4: PRODUCTS - Sản phẩm
// ==========================================

app.MapGet("/api/products", async (Guid? categoryId, string? search, int? page, int? pageSize, decimal? priceFrom, decimal? priceTo, string? sort, IMediator mediator) =>
{
    var result = await mediator.Send(new ListProductsQuery(categoryId, search, page, pageSize, priceFrom, priceTo, sort));
    return Results.Ok(result);
})
.WithName("ListProducts")
.WithSummary("Lấy danh sách sản phẩm với bộ lọc và phân trang (CN-04)")
.WithDescription("Hỗ trợ: lọc theo danh mục (categoryId), tìm kiếm theo tên (search, không phân biệt hoa thường), "
    + "lọc khoảng giá (priceFrom/priceTo), sắp xếp (sort: newest mặc định, price-asc, price-desc), "
    + "phân trang (page, pageSize — mặc định 12 sản phẩm/trang). Sản phẩm ngừng bán bị ẩn. Kết quả được cache 10 phút.")
.WithTags("Products - Sản phẩm");

app.MapGet("/api/products/{id:guid}", async (Guid id, IMediator mediator) =>
{
    var result = await mediator.Send(new GetProductDetailQuery(id));
    return result.Success ? Results.Ok(result) : Results.NotFound(result);
})
.WithName("GetProductDetail")
.WithSummary("Xem chi tiết một sản phẩm (CN-05)")
.WithDescription("Trả về thông tin chi tiết sản phẩm bao gồm: tên, giá, mô tả, hình ảnh, "
    + "tồn kho khả dụng (Stock - ReservedStock), danh sách đánh giá (evaluations), "
    + "rating trung bình và số lượng review. Trả về 404 nếu không tìm thấy hoặc đã ngừng bán.")
.WithTags("Products - Sản phẩm");

app.MapPost("/api/products/{id:guid}/evaluations", async (Guid id, AddEvaluationCommand command, IMediator mediator) =>
{
    var cmd = command with { ProductId = id };
    var result = await mediator.Send(cmd);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AddProductEvaluation")
.WithSummary("Thêm đánh giá (review) cho sản phẩm")
.WithDescription("Cho phép người dùng đánh giá sản phẩm với số sao (1-5) và bình luận. "
    + "Tự động cập nhật rating trung bình và số lượng review của sản phẩm. "
    + "Gửi thông báo real-time qua SignalR khi có đánh giá mới.")
.WithTags("Products - Sản phẩm");

// ==========================================
// MODULE 5: CART - Giỏ hàng phía server theo tài khoản (CN-06, cần JWT)
// ==========================================

app.MapGet("/api/cart", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem giỏ hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new GetCartQuery(userId.Value));
    return Results.Ok(result);
})
.WithName("GetCart")
.WithSummary("Lấy giỏ hàng của tài khoản (CN-06.2/06.5)")
.WithDescription("Trả về giỏ hàng phía server của người dùng đang đăng nhập (JWT). "
    + "Mỗi lần đọc đều đồng bộ giá + tồn kho mới nhất và đánh dấu dòng ngừng bán/hết hàng (isAvailable = false). "
    + "Giỏ chưa tồn tại thì tự tạo mới rỗng.")
.WithTags("Cart - Giỏ hàng");

app.MapPost("/api/cart/items", async (AddToCartRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để thêm vào giỏ hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new AddToCartCommand(userId.Value, request.ProductId, request.Quantity));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AddToCart")
.WithSummary("Thêm sản phẩm vào giỏ hàng (CN-06.1)")
.WithDescription("Trùng sản phẩm thì cộng dồn số lượng; tổng vượt tồn kho khả dụng thì chỉ thêm tới mức tối đa "
    + "và trả thông báo \"Chỉ còn X sản phẩm\" trong trường notice. Cần JWT.")
.WithTags("Cart - Giỏ hàng");

app.MapPut("/api/cart/items/{id:guid}", async (Guid id, UpdateCartItemRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để sửa giỏ hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new UpdateCartItemCommand(userId.Value, id, request.Quantity));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateCartItem")
.WithSummary("Cập nhật số lượng sản phẩm trong giỏ hàng (CN-06.3)")
.WithDescription("Số lượng vượt tồn kho thì đặt về mức tối đa kèm thông báo; số lượng ≤ 0 thì xóa dòng. Cần JWT.")
.WithTags("Cart - Giỏ hàng");

app.MapDelete("/api/cart/items/{id:guid}", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để sửa giỏ hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new RemoveCartItemCommand(userId.Value, id));
    return Results.Ok(result);
})
.WithName("RemoveCartItem")
.WithSummary("Xóa sản phẩm khỏi giỏ hàng (CN-06.3)")
.WithDescription("Xóa một dòng khỏi giỏ của tài khoản đang đăng nhập. Idempotent: item không tồn tại vẫn trả thành công. Cần JWT.")
.WithTags("Cart - Giỏ hàng");

app.MapPost("/api/cart/merge", async (MergeCartRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để gộp giỏ hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new MergeCartCommand(userId.Value, request.Items));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("MergeCart")
.WithSummary("Gộp giỏ khách (localStorage) vào giỏ tài khoản (CN-06.4)")
.WithDescription("FE gọi ngay sau khi đăng nhập: gửi danh sách sản phẩm trong giỏ tạm; BE cộng dồn vào giỏ tài khoản, "
    + "không vượt tồn kho khả dụng, bỏ qua sản phẩm không tồn tại/ngừng bán. Trả về giỏ sau khi gộp kèm notice nếu có dòng bị giới hạn.")
.WithTags("Cart - Giỏ hàng");

// ==========================================
// MODULE 5B: ADDRESSES - Sổ địa chỉ giao hàng (CN-03.3, cần JWT)
// ==========================================

app.MapGet("/api/addresses", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem sổ địa chỉ."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new GetAddressesQuery(userId.Value));
    return Results.Ok(result);
})
.WithName("GetAddresses")
.WithSummary("Danh sách địa chỉ giao hàng của tài khoản")
.WithDescription("Tối đa 5 địa chỉ; địa chỉ mặc định xếp đầu, sau đó mới nhất trước. Cần JWT.")
.WithTags("Addresses - Sổ địa chỉ");

app.MapPost("/api/addresses", async (CreateAddressRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để thêm địa chỉ."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new CreateAddressCommand(
        userId.Value, request.RecipientName, request.Phone, request.ProvinceCode, request.ProvinceName,
        request.DistrictCode, request.DistrictName, request.WardCode, request.WardName,
        request.DetailAddress, request.Note, request.SetAsDefault));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("CreateAddress")
.WithSummary("Thêm địa chỉ giao hàng")
.WithDescription("Địa chỉ đầu tiên tự động là mặc định. Thêm địa chỉ thứ 6 → lỗi (tối đa 5). Cần JWT.")
.WithTags("Addresses - Sổ địa chỉ");

app.MapPut("/api/addresses/{id:guid}", async (Guid id, UpdateAddressRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để sửa địa chỉ."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new UpdateAddressCommand(
        userId.Value, id, request.RecipientName, request.Phone, request.ProvinceCode, request.ProvinceName,
        request.DistrictCode, request.DistrictName, request.WardCode, request.WardName,
        request.DetailAddress, request.Note));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateAddress")
.WithSummary("Sửa địa chỉ giao hàng")
.WithDescription("Chỉ sửa được địa chỉ của chính mình. Cần JWT.")
.WithTags("Addresses - Sổ địa chỉ");

app.MapDelete("/api/addresses/{id:guid}", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xóa địa chỉ."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new DeleteAddressCommand(userId.Value, id));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("DeleteAddress")
.WithSummary("Xóa địa chỉ giao hàng")
.WithDescription("Xóa địa chỉ mặc định → địa chỉ còn lại mới nhất tự thành mặc định. Đơn hàng cũ không bị ảnh hưởng (đã lưu snapshot). Cần JWT.")
.WithTags("Addresses - Sổ địa chỉ");

app.MapPut("/api/addresses/{id:guid}/default", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để đặt địa chỉ mặc định."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new SetDefaultAddressCommand(userId.Value, id));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("SetDefaultAddress")
.WithSummary("Đặt địa chỉ mặc định")
.WithDescription("Đúng một địa chỉ mặc định tại một thời điểm. Cần JWT.")
.WithTags("Addresses - Sổ địa chỉ");

// ==========================================
// MODULE 6: VOUCHERS - Mã giảm giá
// ==========================================

app.MapGet("/api/vouchers", async (IMediator mediator) =>
{
    var result = await mediator.Send(new GetVouchersQuery());
    return Results.Ok(result);
})
.WithName("GetVouchers")
.WithSummary("Lấy danh sách mã giảm giá còn hiệu lực")
.WithDescription("Trả về tất cả voucher đang hoạt động (IsActive = true) và chưa hết hạn. "
    + "Bao gồm thông tin: mã code, loại giảm giá (Percentage/Fixed), giá trị giảm, "
    + "đơn tối thiểu và giới hạn giảm tối đa.")
.WithTags("Vouchers - Mã giảm giá");

app.MapPost("/api/vouchers/apply", async (ApplyVoucherCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ApplyVoucher")
.WithSummary("Áp dụng mã giảm giá vào đơn hàng")
.WithDescription("Kiểm tra và áp dụng mã voucher cho giỏ hàng. Hỗ trợ: "
    + "giảm theo phần trăm (Percentage) với giới hạn tối đa, "
    + "giảm số tiền cố định (Fixed), và mã đặc biệt FORDEV (giảm còn 2.000đ để test PayOS). "
    + "Trả về số tiền được giảm và tổng tiền cuối cùng.")
.WithTags("Vouchers - Mã giảm giá");

// ==========================================
// MODULE 7: ORDERS - Đơn hàng (CN-07, CN-08 — cần JWT)
// ==========================================

app.MapPost("/api/orders/checkout", async (CheckoutCommand command, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để đặt hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    // UserId lấy từ JWT (không tin body); Idempotency-Key lấy từ header nếu body chưa có
    var idempotencyKey = !string.IsNullOrWhiteSpace(command.IdempotencyKey)
        ? command.IdempotencyKey
        : httpContext.Request.Headers["Idempotency-Key"].FirstOrDefault();
    var securedCommand = command with { UserId = userId.Value, IdempotencyKey = idempotencyKey };

    var result = await mediator.Send(securedCommand);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Checkout")
.WithSummary("Đặt hàng — COD hoặc PayOS (CN-07 + O1)")
.WithDescription("Luồng: kiểm tra lại sản phẩm (còn bán, tồn kho, giá hiện tại) → tính tạm tính/phí ship (25.000đ, miễn phí ≥ 299.000đ) "
    + "→ kiểm tra lại voucher ở BE → tạo đơn (mã DH{yyyyMMdd}-{seq}) kèm snapshot địa chỉ giao hàng → COD trừ kho ngay / PayOS giữ kho 15 phút + tạo link "
    + "→ xóa sản phẩm đã đặt khỏi giỏ server. Chống double-submit bằng Idempotency-Key. Cần JWT.")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders", async (int? page, int? pageSize, string? status, string? search, DateTime? from, DateTime? to, decimal? minTotal, decimal? maxTotal, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem đơn hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new GetOrderHistoryQuery(userId.Value, null, page, pageSize, status, search, from, to, minTotal, maxTotal));
    return Results.Ok(result);
})
.WithName("ListMyOrders")
.WithSummary("Danh sách đơn hàng của tôi (CN-08.1)")
.WithDescription("Đơn của chính khách, mới nhất trước, phân trang (page/pageSize), lọc theo trạng thái (status: tên enum hoặc nhãn tiếng Việt). Cần JWT.")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders/history", async (Guid? userId, string? email, HttpContext httpContext, IMediator mediator) =>
{
    // Ưu tiên user từ JWT; tham số userId/email chỉ còn phục vụ tương thích cũ
    var effectiveUserId = httpContext.GetCurrentUserId() ?? userId;
    var result = await mediator.Send(new GetOrderHistoryQuery(effectiveUserId, effectiveUserId.HasValue ? null : email));
    return Results.Ok(result);
})
.WithName("GetOrderHistory")
.WithSummary("Xem lịch sử đơn hàng")
.WithDescription("Trả về tối đa 20 đơn hàng gần nhất, sắp xếp theo ngày tạo mới nhất. "
    + "Bao gồm chi tiết sản phẩm, lịch sử trạng thái và snapshot giao hàng.")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders/{id:guid}", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem đơn hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new GetOrderDetailQuery(userId.Value, id));
    if (result.Data == null)
    {
        return Results.NotFound(ApiResponse<string>.Fail("Không tìm thấy đơn hàng."));
    }
    return Results.Ok(result);
})
.WithName("GetOrderDetail")
.WithSummary("Chi tiết đơn hàng (CN-08.2)")
.WithDescription("Chỉ chủ đơn mới xem được; đơn của người khác (kể cả sửa URL) → 404. Cần JWT.")
.WithTags("Orders - Đơn hàng");

app.MapPost("/api/orders/{id:guid}/cancel", async (Guid id, CancelOrderRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để hủy đơn hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new CancelOrderCommand(userId.Value, id, request.Reason));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("CancelOrder")
.WithSummary("Hủy đơn hàng (CN-08.3)")
.WithDescription("Chỉ hủy được khi đơn đang Chờ xác nhận. Transaction: → Đã hủy + lưu lý do/thời điểm + hoàn tồn kho từng dòng. "
    + "Hủy lần hai → \"Đơn không còn có thể hủy\", không hoàn kho lại. Cần JWT.")
.WithTags("Orders - Đơn hàng");

// ==========================================
// MODULE 8: PAYMENTS - Thanh toán
// ==========================================

app.MapGet("/api/payments/status/{orderCode:long}", async (long orderCode, IMediator mediator) =>
{
    var result = await mediator.Send(new GetPaymentStatusQuery(orderCode));
    return result.Success ? Results.Ok(result) : Results.NotFound(result);
})
.WithName("GetPaymentStatus")
.WithSummary("Kiểm tra trạng thái thanh toán đơn hàng")
.WithDescription("Kiểm tra trạng thái thanh toán theo mã đơn hàng (orderCode). "
    + "Nếu đơn hàng đang Pending, tự động truy vấn PayOS API để kiểm tra xem đã thanh toán chưa "
    + "(xử lý trường hợp webhook bị delay/block). Nếu PayOS xác nhận PAID, "
    + "tự động cập nhật trạng thái đơn hàng, trừ kho và gửi thông báo.")
.WithTags("Payments - Thanh toán");

app.MapPost("/api/payments/payos-webhook", async (PayOSWebhookPayload payload, IMediator mediator) =>
{
    var result = await mediator.Send(new PayOSWebhookCommand(payload));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("PayOSWebhook")
.WithSummary("Nhận webhook từ PayOS khi thanh toán thành công")
.WithDescription("Endpoint nhận callback từ cổng thanh toán PayOS. Xử lý: "
    + "1) Verify chữ ký HMAC-SHA256 để đảm bảo tính xác thực; "
    + "2) Kiểm tra idempotency (không xử lý lại đơn đã thanh toán); "
    + "3) Chuyển trạng thái đơn hàng sang Paid; "
    + "4) Trừ kho chính thức (stock deduction); "
    + "5) Tạo bản ghi PaymentTransaction; "
    + "6) Gửi thông báo real-time qua SignalR; "
    + "7) Publish Kafka event 'payment-events'. "
    + "⚠️ Endpoint này được gọi bởi PayOS server, không phải từ client.")
.WithTags("Payments - Thanh toán");


// ==========================================
// MODULE 9: AUTH MỞ RỘNG — Quên / đặt lại mật khẩu (§9.1)
// ==========================================

app.MapPost("/api/auth/forgot-password", async (ForgotPasswordRequest request, IMediator mediator) =>
{
    var result = await mediator.Send(new ForgotPasswordCommand(request.Email));
    return Results.Ok(result);
})
.WithName("ForgotPassword")
.WithSummary("Quên mật khẩu — xin mã đặt lại (§9.1)")
.WithDescription("Luôn trả cùng 1 câu dù email có tồn tại hay không (chống dò tài khoản). Mã 6 số băm trước khi lưu, hạn 15 phút, tối đa 5 lần nhập sai, tối đa 3 lần gửi/1 giờ. Mã được gửi bằng email thật qua SMTP (IEmailSender, cấu hình SMTP_* trong .env); chỉ khi SMTP chưa cấu hình thì mã mới ghi log ở Development.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/reset-password", async (ResetPasswordRequest request, IMediator mediator) =>
{
    var result = await mediator.Send(new ResetPasswordCommand(request.Email, request.Code, request.NewPassword, request.ConfirmNewPassword));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ResetPassword")
.WithSummary("Đặt lại mật khẩu bằng mã 6 số (§9.1)")
.WithDescription("Mã đúng + còn hạn + mật khẩu mới đạt policy và khác mật khẩu cũ → đổi mật khẩu, hủy mã đã dùng, vô hiệu mọi JWT đang sống (TokenVersion tăng).")
.WithTags("Auth - Xác thực");

// Đăng ký nhận bản tin (footer) — endpoint công khai, lưu thật vào bảng
// NewsletterSubscriptions (bảng được tạo trên DB cũ qua ExtendedSchemaSync).
app.MapPost("/api/newsletter/subscribe", async (NewsletterSubscribeRequest request, AppDbContext dbContext) =>
{
    var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
    if (email.Length is < 5 or > 254 || !System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$"))
        return Results.BadRequest(ApiResponse<string>.Fail("Vui lòng nhập email đúng định dạng."));
    var exists = await dbContext.NewsletterSubscriptions.AnyAsync(s => s.Email == email);
    if (exists)
        return Results.Ok(ApiResponse<string>.Ok(email, "Email này đã đăng ký nhận bản tin DAFL rồi."));
    dbContext.NewsletterSubscriptions.Add(new NewsletterSubscription { Email = email });
    await dbContext.SaveChangesAsync();
    return Results.Ok(ApiResponse<string>.Ok(email, "Cảm ơn bạn đã đăng ký nhận bản tin DAFL."));
})
.WithName("NewsletterSubscribe")
.WithSummary("Đăng ký nhận bản tin: lưu email thật vào DB, trùng email báo đã đăng ký")
.WithTags("Marketing");

// ==========================================
// MODULE 10: MEMBERSHIP — Hội viên (§5, §6, §7.6)
// ==========================================

app.MapGet("/api/membership/me", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem hội viên."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new GetMembershipQuery(userId.Value));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("GetMyMembership")
.WithSummary("Hồ sơ hội viên của tôi: hạng, điểm, chi tiêu 12 tháng, hạng tiếp theo")
.WithTags("Membership - Hội viên");

app.MapGet("/api/membership/points", async (int? page, int? pageSize, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem lịch sử điểm."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new GetPointLedgerQuery(userId.Value, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("GetMyPointLedger")
.WithSummary("Sổ cái điểm: EARN/USE/REFUND/REVOKE/EXPIRED/ADMIN_ADJUST")
.WithTags("Membership - Hội viên");

app.MapGet("/api/membership/vouchers", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem ưu đãi."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new GetMyVouchersQuery(userId.Value));
    return Results.Ok(result);
})
.WithName("GetMyVouchers")
.WithSummary("Ưu đãi của tôi: voucher công khai đúng hạng + voucher cá nhân (sinh nhật/chào hạng)")
.WithTags("Membership - Hội viên");

app.MapPut("/api/membership/preferences", async (MembershipPreferencesRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để cập nhật hội viên."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new UpdateMembershipPreferencesCommand(userId.Value, request.BirthDate, request.DefaultPaymentMethod, request.AutoUsePoints));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateMembershipPreferences")
.WithSummary("Cập nhật ngày sinh / phương thức mặc định / tự dùng điểm (ngày sinh khóa sửa 90 ngày)")
.WithTags("Membership - Hội viên");

app.MapPost("/api/membership/birthday-voucher", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để nhận voucher sinh nhật."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new ClaimBirthdayVoucherCommand(userId.Value));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ClaimBirthdayVoucher")
.WithSummary("Nhận voucher sinh nhật (hạng Vàng trở lên, trong 30 ngày quanh ngày sinh, mỗi năm 1 lần)")
.WithTags("Membership - Hội viên");

app.MapPost("/api/membership/reorder/{orderId:guid}", async (Guid orderId, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để mua lại."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new ReorderCommand(userId.Value, orderId));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Reorder")
.WithSummary("Mua lại 1 chạm: cho sản phẩm còn bán + còn hàng vào giỏ, liệt kê riêng sản phẩm không mua được")
.WithTags("Membership - Hội viên");

// ==========================================
// MODULE 11: PROMOTIONS — Kiểm tra voucher phía khách (§7.4/§7.5)
// ==========================================

app.MapPost("/api/promotions/validate", async (ValidateVoucherRequest request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    var items = request.Items?.Select(i => new ValidateVoucherItemDto(i.ProductId, i.CategoryId, i.LineTotal)).ToList()
        ?? new List<ValidateVoucherItemDto>();
    var result = await mediator.Send(new ValidateVoucherCommand(userId, request.GoodsVoucherCode, request.FreeShipVoucherCode, request.SubTotal, items));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ValidateVoucher")
.WithSummary("Kiểm tra mã giảm giá (1 mã tiền hàng + 1 mã freeship) theo đúng 9 bước §7.5 — chỉ kiểm tra, không trừ lượt")
.WithTags("Promotions - Khuyến mãi");

app.MapGet("/api/promotions/mine", async (HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem ưu đãi."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new GetMyVouchersQuery(userId.Value));
    return Results.Ok(result);
})
.WithName("GetMyPromotions")
.WithSummary("Danh sách voucher tôi đang có (bí danh của /api/membership/vouchers)")
.WithTags("Promotions - Khuyến mãi");

// ==========================================
// MODULE 12: ORDERS — Hành động của khách (§8.1, §9.2)
// ==========================================

app.MapPost("/api/orders/{id:guid}/confirm-received", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xác nhận nhận hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new ConfirmReceivedCommand(userId.Value, id));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ConfirmReceived")
.WithSummary("Khách bấm Đã nhận hàng (Delivered → Completed): cộng điểm + xét hạng")
.WithTags("Orders - Đơn hàng");

app.MapPost("/api/orders/{id:guid}/returns", async (Guid id, CreateReturnRequestBody request, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để yêu cầu trả hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new CreateReturnRequestCommand(userId.Value, id, request.ProductId, request.Quantity, request.Reason, request.Note));
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("CreateReturnRequest")
.WithSummary("Yêu cầu trả hàng trong 7 ngày từ Delivered (§9.2)")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders/{id:guid}/returns", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem yêu cầu trả hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new ListReturnRequestsQuery(userId.Value, id, null, AdminView: false));
    return Results.Ok(result);
})
.WithName("ListMyReturnRequests")
.WithSummary("Yêu cầu trả hàng của 1 đơn (kèm trạng thái hoàn tiền)")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders/{id:guid}/invoice", async (Guid id, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem hóa đơn."), statusCode: StatusCodes.Status401Unauthorized);
    }
    var result = await mediator.Send(new GetInvoiceQuery(userId.Value, id));
    if (result.Data == null)
    {
        return Results.NotFound(ApiResponse<string>.Fail("Không tìm thấy đơn hàng."));
    }
    return Results.Ok(result);
})
.WithName("GetOrderInvoice")
.WithSummary("Dữ liệu hóa đơn từ snapshot lúc mua (chưa xuất PDF)")
.WithTags("Orders - Đơn hàng");

// ==========================================
// MODULE 13: ADMIN — Quản trị (§1–§5, §7–§9)
// Mọi endpoint /api/admin/* đều qua AdminGuard.RequireSuperAdminAsync (Role + TokenVersion + IsLocked).
// ==========================================

app.MapGet("/api/admin/profile", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    return Results.Ok(ApiResponse<object>.Ok(new
    {
        admin!.Id, admin.Email, admin.FullName, admin.PhoneNumber, admin.Address,
        admin.Role, admin.LastLoginAt, admin.CreatedAt,
        EmailReadOnly = true // Email là định danh đăng nhập + nhận OTP — không sửa qua endpoint này (§2.1).
    }));
})
.WithName("GetAdminProfile")
.WithSummary("Hồ sơ Super Admin (email chỉ đọc)")
.WithTags("Admin - Quản trị");

app.MapPut("/api/admin/profile", async (UpdateProfileRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new UpdateProfileCommand(admin!.Id, request.FullName, request.PhoneNumber, request.Address));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin, "ADMIN_UPDATE_PROFILE", "User", admin.Id.ToString(),
            new { admin.FullName, admin.PhoneNumber }, new { request.FullName, request.PhoneNumber },
            AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateAdminProfile")
.WithSummary("Sửa thông tin cá nhân admin: họ tên/SĐT (SĐT không trùng tài khoản khác); email không sửa được")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/change-password", async (ChangePasswordRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator, IEmailSender emailSender) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ChangePasswordCommand(admin!.Id, request.CurrentPassword, request.NewPassword, request.ConfirmNewPassword));
    if (result.Success)
    {
        // TokenVersion đã tăng trong handler → mọi JWT cũ bị vô hiệu, admin phải đăng nhập lại.
        // Gửi email cảnh báo đổi mật khẩu (đợt 13, mục 1): SMTP đã cấu hình thì gửi mail thật,
        // chưa cấu hình thì chỉ ghi log.
        var mailSent = emailSender.IsConfigured && await emailSender.SendAsync(admin.Email,
            "DAFL Admin — Mật khẩu quản trị vừa được thay đổi",
            $"""
            <p>Xin chào,</p>
            <p>Mật khẩu tài khoản quản trị DAFL (<b>{admin.Email}</b>) vừa được thay đổi lúc {DateTime.UtcNow:HH:mm} UTC ngày {DateTime.UtcNow:dd/MM/yyyy}.</p>
            <p>Nếu không phải bạn thực hiện, hãy liên hệ ngay quản trị hệ thống và đổi lại mật khẩu.</p>
            <p>Trân trọng,<br/>Đội ngũ DAFL</p>
            """);
        if (!mailSent)
        {
            app.Logger.LogWarning("Admin password changed for {Email}. All sessions invalidated. Warning email not sent (SMTP not configured or send failed).", admin.Email);
        }
        await AdminGuard.WriteAuditAsync(dbContext, admin, "ADMIN_CHANGE_PASSWORD", "User", admin.Id.ToString(),
            null, new { ChangedAt = DateTime.UtcNow }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminChangePassword")
.WithSummary("Đổi mật khẩu Super Admin: kiểm tra mật khẩu cũ + policy mới + khác mật khẩu cũ; JWT cũ bị hủy")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/dashboard", async (HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new GetAdminDashboardQuery());
    return Results.Ok(result);
})
.WithName("GetAdminDashboard")
.WithSummary("Dashboard: doanh thu hôm nay/tháng, đơn theo trạng thái, sắp hết hàng, voucher sắp hết lượt")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/reports/revenue", async (DateTime? from, DateTime? to, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new GetRevenueReportQuery(from, to));
    return Results.Ok(result);
})
.WithName("GetAdminRevenueReport")
.WithSummary("Báo cáo: doanh thu theo ngày, sản phẩm bán chạy, tỉ lệ hủy, tỉ lệ dùng voucher")
.WithTags("Admin - Quản trị");

// --- Upload ảnh (admin) — đợt redesign form admin ---
// POST /api/admin/upload nhận multipart/form-data, field "file" (alias "image").
// Chỉ ảnh PNG/JPEG/WebP ≤ 5MB (kiểm tra ContentType + extension + magic bytes),
// lưu thành <uuid>.<ext> trong thư mục uploads và trả về URL TUYỆT ĐỐI tới backend
// (xem UploadImageHelper.BuildPublicUploadUrl): ảnh hiển thị bằng <img src={imageUrl}>
// nên URL tương đối "/uploads/..." sẽ bị trình duyệt tải từ :3000/:3001 — nginx của
// shop/admin không có location /uploads nên sẽ 404. Không ghi audit log: upload
// không phải nghiệp vụ thay đổi dữ liệu (ảnh chỉ được tham chiếu khi tạo/sửa sản phẩm
// hoặc danh mục — lúc đó mới có audit ADMIN_CREATE/UPDATE_PRODUCT/CATEGORY).
app.MapPost("/api/admin/upload", async (HttpContext httpContext, AppDbContext dbContext, IConfiguration configuration) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;

    if (!httpContext.Request.HasFormContentType)
    {
        return Results.Json(new { success = false, message = "Yêu cầu phải là multipart/form-data với field \"file\"." },
            statusCode: StatusCodes.Status400BadRequest);
    }

    IFormFile? file;
    try
    {
        var form = await httpContext.Request.ReadFormAsync();
        file = form.Files["file"] ?? form.Files["image"];
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Upload: cannot read multipart form.");
        return Results.Json(new { success = false, message = "Không đọc được dữ liệu upload. Hãy gửi lại dưới dạng multipart/form-data." },
            statusCode: StatusCodes.Status400BadRequest);
    }

    var (invalidMessage, extension) = UploadImageHelper.ValidateImage(file);
    if (invalidMessage != null)
    {
        return Results.Json(new { success = false, message = invalidMessage },
            statusCode: StatusCodes.Status400BadRequest);
    }

    var fileName = $"{Guid.NewGuid():N}{extension}";
    var uploadsDir = UploadImageHelper.GetUploadsRoot();
    Directory.CreateDirectory(uploadsDir);
    var filePath = Path.Combine(uploadsDir, fileName);
    await using (var stream = new FileStream(filePath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    {
        await file!.CopyToAsync(stream);
    }

    var relativePath = $"/uploads/{fileName}";
    var absoluteUrl = UploadImageHelper.BuildPublicUploadUrl(httpContext, configuration, fileName);
    return Results.Json(new { url = absoluteUrl, path = relativePath });
})
.WithName("AdminUploadImage")
.WithSummary("Admin upload ảnh sản phẩm/danh mục (PNG/JPEG/WebP ≤ 5MB), trả về URL tuyệt đối tới backend")
.WithTags("Admin - Quản trị");

// --- Sản phẩm / Danh mục (admin) ---
app.MapPost("/api/admin/products", async (CreateProductRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new CreateProductCommand(request.Name, request.CategoryId, request.Price, request.OriginalPrice, request.Stock, request.Description, request.ImageUrl, request.Slug, request.ImageUrls));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_CREATE_PRODUCT", "Product", result.Data!.Id.ToString(),
            null, new { request.Name, request.Price, request.Stock }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminCreateProduct")
.WithSummary("Admin tạo sản phẩm (tên 3–120, giá > 0, giá KM < giá gốc, tồn kho ≥ 0, danh mục đang hiển thị)")
.WithTags("Admin - Quản trị");

app.MapPut("/api/admin/products/{id:guid}", async (Guid id, UpdateProductRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var before = await dbContext.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id);
    var result = await mediator.Send(new UpdateProductCommand(id, request.Name, request.CategoryId, request.Price, request.OriginalPrice, request.Stock, request.Description, request.ImageUrl, request.IsActive, request.ImageUrls));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_UPDATE_PRODUCT", "Product", id.ToString(),
            before == null ? null : new { before.Name, before.Price, before.Stock, before.IsActive },
            new { request.Name, request.Price, request.Stock, request.IsActive }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminUpdateProduct")
.WithSummary("Admin sửa sản phẩm (kèm ẩn/hiện)")
.WithTags("Admin - Quản trị");

app.MapDelete("/api/admin/products/{id:guid}", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new DeleteProductCommand(id));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_DELETE_PRODUCT", "Product", id.ToString(),
            null, new { IsDeleted = true }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminDeleteProduct")
.WithSummary("Admin xóa mềm sản phẩm (giữ lịch sử đơn)")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/categories", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var categories = await dbContext.Categories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync();
    var counts = await dbContext.Products.Where(p => !p.IsDeleted).GroupBy(p => p.CategoryId)
        .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
    var dtos = categories.Select(c => new AdminCategoryDto(c.Id, c.Name, c.Slug, c.Description, c.IsActive, c.SortOrder, counts.GetValueOrDefault(c.Id), c.IconUrl)).ToList();
    return Results.Ok(ApiResponse<List<AdminCategoryDto>>.Ok(dtos));
})
.WithName("AdminListCategories")
.WithSummary("Danh sách danh mục cho admin (kèm số sản phẩm)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/categories", async (CreateCategoryRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new CreateCategoryCommand(request.Name, request.Description, request.Slug, request.SortOrder, request.IconUrl));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_CREATE_CATEGORY", "Category", result.Data!.Id.ToString(),
            null, new { request.Name }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminCreateCategory")
.WithSummary("Admin tạo danh mục")
.WithTags("Admin - Quản trị");

app.MapPut("/api/admin/categories/{id:guid}", async (Guid id, UpdateCategoryRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new UpdateCategoryCommand(id, request.Name, request.Description, request.IsActive, request.SortOrder, request.Slug, request.IconUrl));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_UPDATE_CATEGORY", "Category", id.ToString(),
            null, new { request.Name, request.IsActive }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminUpdateCategory")
.WithSummary("Admin sửa / ẩn / sắp xếp danh mục")
.WithTags("Admin - Quản trị");

app.MapDelete("/api/admin/categories/{id:guid}", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new DeleteCategoryCommand(id));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_DELETE_CATEGORY", "Category", id.ToString(),
            null, null, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminDeleteCategory")
.WithSummary("Admin xóa danh mục (chặn khi còn sản phẩm)")
.WithTags("Admin - Quản trị");

// --- Đơn hàng (admin) ---
app.MapGet("/api/admin/orders", async (string? status, DateTime? from, DateTime? to, string? paymentMethod, string? search, bool? hasVoucher, bool? hasPoints, int? page, int? pageSize, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListAdminOrdersQuery(status, from, to, paymentMethod, search, hasVoucher, hasPoints, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("AdminListOrders")
.WithSummary("Admin xem đơn: lọc trạng thái/ngày/phương thức/voucher/điểm, tìm theo mã đơn/tên khách/tên SP")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/orders/{id:guid}", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new GetAdminOrderDetailQuery(id));
    if (result.Data == null)
    {
        return Results.NotFound(ApiResponse<string>.Fail("Không tìm thấy đơn hàng."));
    }
    return Results.Ok(result);
})
.WithName("AdminGetOrderDetail")
.WithSummary("Admin xem chi tiết đơn (kèm ghi chú nội bộ, lịch sử trạng thái)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/orders/{id:guid}/status", async (Guid id, ChangeOrderStatusRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ChangeOrderStatusCommand(id, admin!.Id, request.ToStatus, request.Carrier, request.TrackingCode, request.Note, request.InternalNote));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin, "ADMIN_CHANGE_ORDER_STATUS", "Order", id.ToString(),
            null, new { request.ToStatus, request.Carrier, request.TrackingCode }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminChangeOrderStatus")
.WithSummary("Admin đổi trạng thái đơn theo máy trạng thái §4 (Shipping bắt buộc có đơn vị vận chuyển + mã vận đơn 6–30 ký tự)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/orders/{id:guid}/cancel", async (Guid id, CancelOrderRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new AdminCancelOrderCommand(id, admin!.Id, request.Reason ?? string.Empty));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin, "ADMIN_CANCEL_ORDER", "Order", id.ToString(),
            null, new { request.Reason }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminCancelOrder")
.WithSummary("Admin hủy đơn trước Shipping (bắt buộc lý do; hoàn kho + hoàn điểm + nhả voucher)")
.WithTags("Admin - Quản trị");

// --- Khách hàng (admin) ---
app.MapGet("/api/admin/customers", async (string? search, string? tier, int? page, int? pageSize, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListCustomersQuery(search, tier, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("AdminListCustomers")
.WithSummary("Admin xem khách hàng: hồ sơ, hạng, chi tiêu 12 tháng, số đơn")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/customers/{id:guid}", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var user = await dbContext.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
    if (user == null || user.Role != "Customer")
    {
        return Results.NotFound(ApiResponse<string>.Fail("Không tìm thấy khách hàng."));
    }
    var orderCount = await dbContext.Orders.CountAsync(o => o.UserId == id);
    var orders = await mediator.Send(new GetOrderHistoryQuery(id, null, 1, 10, null));
    var availablePoints = await MembershipService.AvailablePointsAsync(dbContext, user.Id, default);
    return Results.Ok(ApiResponse<object>.Ok(new
    {
        customer = new AdminCustomerDto(user.Id, user.Email, user.FullName, user.PhoneNumber, user.Role, user.IsLocked,
            user.MembershipTier, user.TotalSpent12m, orderCount, user.CreatedAt, user.LastLoginAt, availablePoints),
        recentOrders = orders.Data ?? new List<OrderHistoryDto>()
    }));
})
.WithName("AdminGetCustomerDetail")
.WithSummary("Admin xem hồ sơ + 10 đơn gần nhất của 1 khách")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/customers/{id:guid}/lock", async (Guid id, LockCustomerRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new LockCustomerCommand(id, request.Reason));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_LOCK_CUSTOMER", "User", id.ToString(),
            new { IsLocked = false }, new { IsLocked = true, request.Reason }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminLockCustomer")
.WithSummary("Admin khóa tài khoản khách (không đăng nhập/checkout được; JWT đang sống bị hủy)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/customers/{id:guid}/unlock", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new UnlockCustomerCommand(id));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_UNLOCK_CUSTOMER", "User", id.ToString(),
            new { IsLocked = true }, new { IsLocked = false }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminUnlockCustomer")
.WithSummary("Admin mở khóa tài khoản khách")
.WithTags("Admin - Quản trị");

// --- Khuyến mãi (admin) ---
app.MapGet("/api/admin/promotions", async (string? status, int? page, int? pageSize, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListPromotionsQuery(status, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("AdminListPromotions")
.WithSummary("Admin xem khuyến mãi theo vòng đời Draft/Active/Disabled/Expired")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/promotions", async (CreatePromotionRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new CreatePromotionCommand(request.Code, request.Description, request.DiscountType, request.DiscountValue, request.MinOrderAmount, request.MaxDiscountAmount, request.StartDate, request.ExpiryDate, request.MaxUses, request.MaxUsesPerUser, request.MinTier, request.ScopeType, request.ScopeCategoryId, request.ScopeProductIds));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_CREATE_PROMOTION", "Voucher", result.Data!.Id.ToString(),
            null, new { request.Code, request.DiscountType, request.DiscountValue }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminCreatePromotion")
.WithSummary("Admin tạo khuyến mãi ở trạng thái Nháp (chưa chạy cho tới khi kích hoạt)")
.WithTags("Admin - Quản trị");

app.MapPut("/api/admin/promotions/{id:guid}", async (Guid id, UpdatePromotionRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new UpdatePromotionCommand(id, request.MaxUses, request.ExpiryDate, request.Description, request.MinOrderAmount, request.MaxDiscountAmount, request.DiscountValue));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_UPDATE_PROMOTION", "Voucher", id.ToString(),
            null, new { request.MaxUses, request.ExpiryDate, request.DiscountValue }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminUpdatePromotion")
.WithSummary("Admin sửa khuyến mãi (Draft sửa hết; Active chỉ tăng lượt/kéo dài hạn)")
.WithTags("Admin - Quản trị");

app.MapDelete("/api/admin/promotions/{id:guid}", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new DeletePromotionCommand(id));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_DELETE_PROMOTION", "Voucher", id.ToString(),
            new { Status = "Draft" }, null, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminDeletePromotion")
.WithSummary("Admin xóa khuyến mãi (chỉ voucher Nháp chưa có lượt dùng)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/promotions/{id:guid}/activate", async (Guid id, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ActivatePromotionCommand(id));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_ACTIVATE_PROMOTION", "Voucher", id.ToString(),
            new { Status = "Draft" }, new { Status = "Active" }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminActivatePromotion")
.WithSummary("Admin kích hoạt khuyến mãi (Draft → Active)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/promotions/{id:guid}/disable", async (Guid id, DisablePromotionRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new DisablePromotionCommand(id, request.Reason));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_DISABLE_PROMOTION", "Voucher", id.ToString(),
            new { Status = "Active" }, new { Status = "Disabled", request.Reason }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminDisablePromotion")
.WithSummary("Admin tắt khẩn cấp khuyến mãi (ghi lý do; đơn đã áp giữ nguyên giảm giá)")
.WithTags("Admin - Quản trị");

app.MapGet("/api/admin/promotions/{id:guid}/usage", async (Guid id, int? page, int? pageSize, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListPromotionUsageQuery(id, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("AdminListPromotionUsage")
.WithSummary("Admin xem lượt dùng của 1 khuyến mãi")
.WithTags("Admin - Quản trị");

// --- Hội viên (admin) ---
app.MapGet("/api/admin/membership/config", async (HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new GetMembershipConfigQuery());
    return Results.Ok(result);
})
.WithName("AdminGetMembershipConfig")
.WithSummary("Admin xem cấu hình ngưỡng hạng + tỉ lệ điểm")
.WithTags("Admin - Quản trị");

app.MapPut("/api/admin/membership/config", async (UpdateMembershipConfigRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var tiers = request.Tiers.Select(t => new MembershipConfigDto(t.Tier, t.MinSpent, t.SpendPerPoint, t.MaxPointsPercent, t.FreeShipThreshold)).ToList();
    var result = await mediator.Send(new UpdateMembershipConfigCommand(tiers));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_UPDATE_MEMBERSHIP_CONFIG", "MembershipTierConfig", null,
            null, tiers, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminUpdateMembershipConfig")
.WithSummary("Admin sửa cấu hình hạng (chỉ áp dụng cho đơn phát sinh sau đó)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/membership/{userId:guid}/adjust-points", async (Guid userId, AdjustPointsRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new AdjustPointsCommand(userId, request.Points, request.Reason));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_ADJUST_POINTS", "User", userId.ToString(),
            null, new { request.Points, request.Reason }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminAdjustPoints")
.WithSummary("Admin điều chỉnh điểm thủ công (tối đa 1.000 điểm/lần, bắt buộc lý do, có AuditLog)")
.WithTags("Admin - Quản trị");

// --- Nhật ký hệ thống (chỉ đọc) ---
app.MapGet("/api/admin/audit-log", async (string? action, Guid? actorId, DateTime? from, DateTime? to, int? page, int? pageSize, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListAuditLogQuery(action, actorId, from, to, page ?? 1, pageSize ?? 20));
    return Results.Ok(result);
})
.WithName("AdminListAuditLog")
.WithSummary("Admin xem AuditLog (lọc theo người/hành động/ngày; không sửa/xóa được)")
.WithTags("Admin - Quản trị");

// --- Trả hàng / hoàn tiền (admin) ---
app.MapGet("/api/admin/returns", async (string? status, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (_, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ListReturnRequestsQuery(null, null, status, AdminView: true));
    return Results.Ok(result);
})
.WithName("AdminListReturns")
.WithSummary("Admin xem yêu cầu trả hàng chờ duyệt")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/returns/{id:guid}/resolve", async (Guid id, ResolveReturnRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new ResolveReturnRequestCommand(id, admin!.Id, request.Approve, request.AdminNote));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin, "ADMIN_RESOLVE_RETURN", "ReturnRequest", id.ToString(),
            new { Status = "Pending" }, new { request.Approve, request.AdminNote }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminResolveReturn")
.WithSummary("Admin duyệt/từ chối trả hàng (từ chối bắt buộc lý do; duyệt tạo bản ghi hoàn tiền Chờ hoàn tiền)")
.WithTags("Admin - Quản trị");

app.MapPost("/api/admin/refunds/{id:guid}/record", async (Guid id, RecordRefundRequest request, HttpContext httpContext, AppDbContext dbContext, IMediator mediator) =>
{
    var (admin, error) = await AdminGuard.RequireSuperAdminAsync(httpContext, dbContext);
    if (error != null) return error;
    var result = await mediator.Send(new RecordRefundCommand(id, request.TransactionCode));
    if (result.Success)
    {
        await AdminGuard.WriteAuditAsync(dbContext, admin!, "ADMIN_RECORD_REFUND", "RefundRecord", id.ToString(),
            new { Status = "PendingRefund" }, new { Status = "Refunded", request.TransactionCode }, AdminGuard.ClientIp(httpContext));
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AdminRecordRefund")
.WithSummary("Admin ghi nhận đã hoàn tiền (nhập mã giao dịch hoàn) — hoàn tiền tự động qua PayOS là hướng phát triển")
.WithTags("Admin - Quản trị");

// Auto-seed database schema, users, vouchers, 26 categories, products
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await DbInitializer.InitializeAsync(db, app.Logger);
}

app.Run();

public record NewsletterSubscribeRequest(string? Email);

public record UpdateProfileRequest(string? FullName, string? PhoneNumber, string? Address);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword, string? ConfirmNewPassword);

public record AddToCartRequest(Guid ProductId, int Quantity);

public record UpdateCartItemRequest(int Quantity);

public record MergeCartRequest(List<MergeCartItemDto> Items);

public record CreateAddressRequest(
    string RecipientName, string Phone, string ProvinceCode, string ProvinceName,
    string DistrictCode, string DistrictName, string WardCode, string WardName,
    string DetailAddress, string? Note, bool SetAsDefault = false);

public record UpdateAddressRequest(
    string RecipientName, string Phone, string ProvinceCode, string ProvinceName,
    string DistrictCode, string DistrictName, string WardCode, string WardName,
    string DetailAddress, string? Note);

public record CancelOrderRequest(string? Reason);

public record SocialGoogleRequest(string IdToken);

public record SocialFacebookRequest(string AccessToken);

public record SocialMockRequest(string Provider);

public record SetPasswordRequest(string NewPassword);

public record ForgotPasswordRequest(string Email);

public record ResetPasswordRequest(string Email, string Code, string NewPassword, string? ConfirmNewPassword);

public record MembershipPreferencesRequest(DateTime? BirthDate, string? DefaultPaymentMethod, bool? AutoUsePoints);

public record ValidateVoucherItemRequest(Guid ProductId, Guid CategoryId, decimal LineTotal);

public record ValidateVoucherRequest(string? GoodsVoucherCode, string? FreeShipVoucherCode, decimal SubTotal, List<ValidateVoucherItemRequest>? Items);

public record CreateReturnRequestBody(Guid ProductId, int Quantity, string Reason, string? Note);

public record CreateProductRequest(string Name, Guid CategoryId, decimal Price, decimal? OriginalPrice, int Stock, string Description, string ImageUrl, string? Slug = null, List<string>? ImageUrls = null);

public record UpdateProductRequest(string Name, Guid CategoryId, decimal Price, decimal? OriginalPrice, int Stock, string Description, string ImageUrl, bool IsActive, List<string>? ImageUrls = null);

public record CreateCategoryRequest(string Name, string? Description, string? Slug = null, int SortOrder = 0, string? IconUrl = null);

public record UpdateCategoryRequest(string Name, string? Description, bool IsActive, int SortOrder, string? Slug = null, string? IconUrl = null);

public record ChangeOrderStatusRequest(string ToStatus, string? Carrier, string? TrackingCode, string? Note, string? InternalNote);

public record LockCustomerRequest(string? Reason);

public record CreatePromotionRequest(
    string Code, string Description, string DiscountType, decimal DiscountValue,
    decimal MinOrderAmount, decimal? MaxDiscountAmount, DateTime? StartDate, DateTime? ExpiryDate,
    int? MaxUses, int? MaxUsesPerUser, string? MinTier, string ScopeType, Guid? ScopeCategoryId,
    string? ScopeProductIds);

public record UpdatePromotionRequest(int? MaxUses, DateTime? ExpiryDate, string? Description, decimal? MinOrderAmount, decimal? MaxDiscountAmount, decimal? DiscountValue = null);

public record DisablePromotionRequest(string Reason);

public record AdjustPointsRequest(int Points, string Reason);

public record MembershipConfigItemDto(string Tier, decimal MinSpent, int SpendPerPoint, int MaxPointsPercent, decimal? FreeShipThreshold);

public record UpdateMembershipConfigRequest(List<MembershipConfigItemDto> Tiers);

public record ResolveReturnRequest(bool Approve, string? AdminNote);

public record RecordRefundRequest(string TransactionCode);

/// <summary>
/// Upload ảnh admin (đợt redesign form admin): validate + đường dẫn thư mục uploads
/// + URL công khai trả về cho client. Không dùng thư viện ngoài — chỉ API .NET 8 sẵn có.
/// </summary>
public static class UploadImageHelper
{
    /// <summary>Dung lượng tối đa 1 file ảnh: 5 MB.</summary>
    public const long MaxFileSizeBytes = 5L * 1024 * 1024;

    private static readonly Dictionary<string, string> AllowedByExtension = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".webp"] = "image/webp"
    };

    /// <summary>Thư mục lưu ảnh: "uploads" dưới thư mục chạy của backend (trong container là /app/uploads).</summary>
    public static string GetUploadsRoot() => Path.Combine(AppContext.BaseDirectory, "uploads");

    /// <summary>
    /// Validate file ảnh: bắt buộc có file, ≤ 5MB, extension + ContentType thuộc
    /// PNG/JPEG/WebP và magic bytes đầu file khớp đúng định dạng đó.
    /// Trả về (thông báo lỗi, extension đã chuẩn hóa thường) — lỗi = null khi hợp lệ.
    /// </summary>
    public static (string? Error, string Extension) ValidateImage(IFormFile? file)
    {
        if (file == null || file.Length == 0)
            return ("Vui lòng chọn file ảnh để tải lên (field \"file\").", string.Empty);
        if (file.Length > MaxFileSizeBytes)
            return ("File ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.", string.Empty);

        var extension = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (!AllowedByExtension.TryGetValue(extension, out var expectedContentType))
            return ("Chỉ chấp nhận file ảnh .png, .jpg, .jpeg, .webp.", string.Empty);
        if (!string.Equals(file.ContentType?.Trim(), expectedContentType, StringComparison.OrdinalIgnoreCase))
            return ("Định dạng ảnh không hợp lệ. Chỉ chấp nhận PNG, JPEG, WebP.", string.Empty);

        // Magic bytes: PNG 89 50 4E 47 0D 0A 1A 0A; JPEG FF D8 FF; WebP "RIFF"...."WEBP".
        // Đọc tối đa 12 byte đầu — file rỗng đã bị loại ở trên nên luôn đọc được ít nhất 1 byte.
        var header = new byte[12];
        using var stream = file.OpenReadStream();
        var read = stream.Read(header, 0, header.Length);
        var valid = expectedContentType switch
        {
            "image/png" => read >= 8
                && header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47
                && header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A,
            "image/jpeg" => read >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,
            "image/webp" => read >= 12
                && header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F'
                && header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P',
            _ => false
        };
        if (!valid)
            return ("Nội dung file không phải ảnh PNG/JPEG/WebP hợp lệ.", string.Empty);
        return (null, extension);
    }

    /// <summary>
    /// URL tuyệt đối trỏ tới file đã upload, để FE gán thẳng vào &lt;img src&gt; / ImageUrl.
    /// Vì sao không trả URL tương đối "/uploads/...": trình duyệt sẽ tải ảnh từ origin
    /// đang mở (:3000 shop / :3001 admin) mà nginx của 2 app đó không có location
    /// /uploads nên sẽ 404 — chỉ backend :5000 mới serve thư mục này (UseStaticFiles).
    /// Cách tính host:
    /// - Ưu tiên cấu hình Uploads:PublicBaseUrl (biến môi trường Uploads__PublicBaseUrl),
    ///   vd http://localhost:5000 — dùng khi chạy ở cổng backend khác mặc định.
    /// - Mặc định lấy scheme + host từ request. LƯU Ý: nginx shop/admin proxy /api về
    ///   backend nhưng giữ nguyên Host gốc ($host) nên request qua :3000/:3001 sẽ thấy
    ///   Host = localhost:3000/3001 (vite dev :5173 tương tự); cổng đó bị đổi về cổng
    ///   public của backend (BACKEND_PORT, mặc định 5000). Gọi thẳng :5000 hoặc qua vite
    ///   proxy (changeOrigin=true) thì Host đã là localhost:5000 nên giữ nguyên.
    /// </summary>
    public static string BuildPublicUploadUrl(HttpContext http, IConfiguration configuration, string fileName)
    {
        var relativePath = $"/uploads/{fileName}";
        var configured = configuration["Uploads:PublicBaseUrl"]?.Trim().TrimEnd('/');
        if (!string.IsNullOrWhiteSpace(configured))
            return configured + relativePath;

        var scheme = http.Request.Headers.TryGetValue("X-Forwarded-Proto", out var forwardedProto)
                && !string.IsNullOrWhiteSpace(forwardedProto)
            ? forwardedProto.ToString() : http.Request.Scheme;
        var host = http.Request.Host.Host;
        var port = http.Request.Host.Port;
        if (IsLocalHost(host) && port is 3000 or 3001 or 5173)
        {
            port = int.TryParse(Environment.GetEnvironmentVariable("BACKEND_PORT"), out var backendPort)
                ? backendPort : 5000;
        }
        var authority = port.HasValue ? $"{host}:{port.Value}" : host;
        return $"{scheme}://{authority}{relativePath}";
    }

    private static bool IsLocalHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host == "127.0.0.1" || host == "::1";
}
