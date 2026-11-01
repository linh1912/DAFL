using DAFL.Backend.Common;
using DAFL.Backend.Common.Behaviors;
using DAFL.Backend.Features.Auth;
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
using DAFL.Backend.Infrastructure.Hubs;
using DAFL.Backend.Infrastructure.Messaging;
using DAFL.Backend.Infrastructure.Payments;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
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

// 7b. JWT (CN-02): đăng nhập/đăng ký/social cấp JWT HS256 hạn 1 giờ, secret từ Jwt:Secret (env JWT_SECRET).
// Theo CN, hệ thống KHÔNG còn OTP email → không còn SMTP/email sender trong bản này.
builder.Services.AddSingleton<IJwtService, JwtService>();

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

// JWT authentication middleware (CN-02): có header "Authorization: Bearer <token>" hợp lệ
// thì gán userId vào HttpContext.Items["CurrentUserId"] để các endpoint cần đăng nhập đọc qua GetCurrentUserId().
// Token sai/hết hạn → không gán (endpoint bảo vệ tự trả 401; client hiển thị "Phiên đăng nhập đã hết hạn").
app.Use(async (context, next) =>
{
    var authorization = context.Request.Headers.Authorization.ToString();
    if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        var jwtService = context.RequestServices.GetRequiredService<IJwtService>();
        var userId = jwtService.ValidateToken(authorization["Bearer ".Length..].Trim());
        if (userId.HasValue)
        {
            context.Items[HttpContextAuthExtensions.CurrentUserIdItemKey] = userId.Value;
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

app.MapGet("/api/orders", async (int? page, int? pageSize, string? status, HttpContext httpContext, IMediator mediator) =>
{
    var userId = httpContext.GetCurrentUserId();
    if (!userId.HasValue)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để xem đơn hàng."), statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await mediator.Send(new GetOrderHistoryQuery(userId.Value, null, page, pageSize, status));
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

// Auto-seed database schema, users, vouchers, 26 categories, products
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await DbInitializer.InitializeAsync(db, app.Logger);
}

app.Run();

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
