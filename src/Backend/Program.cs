using DAFL.Backend.Common;
using DAFL.Backend.Common.Behaviors;
using DAFL.Backend.Features.Auth;
using DAFL.Backend.Features.Auth.SessionLogin;
using DAFL.Backend.Features.Cart;
using DAFL.Backend.Features.Categories.GetCategories;
using DAFL.Backend.Features.Orders;
using DAFL.Backend.Features.Orders.Checkout;
using DAFL.Backend.Features.Orders.GetOrderHistory;
using DAFL.Backend.Features.Payments.GetPaymentStatus;
using DAFL.Backend.Features.Payments.PayOSWebhook;
using DAFL.Backend.Features.Products;
using DAFL.Backend.Features.Products.ListProducts;
using DAFL.Backend.Features.Vouchers;
using DAFL.Backend.Infrastructure.Caching;
using DAFL.Backend.Infrastructure.Data;
using DAFL.Backend.Infrastructure.Email;
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

// 7b. Email & OTP (xác thực email / quên mật khẩu / đăng nhập OTP)
// Có Email:SmtpHost thì gửi SMTP thật, không có thì LogEmailSender (dev).
if (!string.IsNullOrWhiteSpace(builder.Configuration["Email:SmtpHost"]))
{
    builder.Services.AddScoped<IEmailSender, SmtpEmailSender>();
}
else
{
    builder.Services.AddScoped<IEmailSender, LogEmailSender>();
}
builder.Services.AddScoped<IOtpService, OtpService>();

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
.WithSummary("Đăng ký tài khoản mới")
.WithDescription("Tạo tài khoản người dùng mới với email, mật khẩu và thông tin cá nhân. "
    + "Tài khoản được tạo ở trạng thái CHƯA xác thực email và KHÔNG có session: hệ thống gửi mã OTP 6 số "
    + "về đúng email vừa đăng ký; gọi POST /api/auth/verify-email để kích hoạt và nhận session cookie (sid). "
    + "Mật khẩu phải thỏa 4 quy tắc: ≥ 8 ký tự, ≥ 1 chữ hoa, ≥ 1 chữ số, ≥ 1 ký tự đặc biệt.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/verify-email", async (VerifyEmailCommand command, HttpContext httpContext, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    if (result.Success && result.Data != null)
    {
        httpContext.Response.Cookies.Append("sid", result.Data.SessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = false,
            Expires = DateTimeOffset.UtcNow.AddDays(7)
        });
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("VerifyEmail")
.WithSummary("Xác thực email bằng mã OTP sau đăng ký")
.WithDescription("Kiểm tra mã OTP 6 số (hạn 10 phút, dùng 1 lần, sai 5 lần bị vô hiệu). "
    + "Đúng mã → tài khoản được kích hoạt (EmailVerified = true) và tự đăng nhập: tạo session cookie (sid) 7 ngày giống hệt luồng login.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/resend-verification", async (ResendVerificationCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ResendVerification")
.WithSummary("Gửi lại mã xác thực email")
.WithDescription("Gửi mã OTP xác thực mới nếu tài khoản tồn tại và chưa xác thực. "
    + "Tôn trọng cooldown 60 giây giữa hai lần gửi và trần 5 mã/giờ. "
    + "Trả về thông báo generic, không lộ email có tồn tại hay không.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/forgot-password", async (ForgotPasswordCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return Results.Ok(result);
})
.WithName("ForgotPassword")
.WithSummary("Yêu cầu đặt lại mật khẩu (quên mật khẩu)")
.WithDescription("Nếu email tồn tại, gửi mã OTP 6 số để đặt lại mật khẩu. "
    + "Luôn trả về cùng một thông báo generic cho mọi đầu vào (chống dò tài khoản), "
    + "và vẫn hoạt động khi tài khoản đang bị khóa mềm.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/reset-password", async (ResetPasswordCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("ResetPassword")
.WithSummary("Đặt lại mật khẩu bằng mã OTP")
.WithDescription("Kiểm tra mã OTP, validate mật khẩu mới theo policy 4 quy tắc, không được trùng mật khẩu cũ. "
    + "Thành công → đổi mật khẩu và hủy TẤT CẢ session đang đăng nhập của tài khoản.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/otp-login/request", async (OtpLoginRequestCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return Results.Ok(result);
})
.WithName("OtpLoginRequest")
.WithSummary("Yêu cầu mã OTP để đăng nhập không cần mật khẩu")
.WithDescription("Nếu email tồn tại, gửi mã OTP 6 số để đăng nhập. "
    + "Luôn trả về thông báo generic cho mọi đầu vào (chống dò tài khoản). "
    + "Đây cũng là lối mở khóa ngay khi tài khoản bị khóa mềm ở làn mật khẩu.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/otp-login/verify", async (OtpLoginVerifyCommand command, HttpContext httpContext, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    if (result.Success && result.Data != null)
    {
        httpContext.Response.Cookies.Append("sid", result.Data.SessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = false,
            Expires = DateTimeOffset.UtcNow.AddDays(7)
        });
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("OtpLoginVerify")
.WithSummary("Đăng nhập bằng mã OTP")
.WithDescription("Kiểm tra mã OTP đăng nhập (hạn 10 phút, dùng 1 lần, sai 5 lần bị vô hiệu). "
    + "Đúng mã → tạo session cookie (sid) 7 ngày giống hệt luồng login; đồng thời email được coi là đã xác thực "
    + "và tài khoản được mở khóa mềm ngay (reset bộ đếm sai mật khẩu).")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/login", async (LoginCommand command, HttpContext httpContext, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    if (result.Success && result.Data != null)
    {
        httpContext.Response.Cookies.Append("sid", result.Data.SessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = false,
            Expires = DateTimeOffset.UtcNow.AddDays(7)
        });
    }
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Login")
.WithSummary("Đăng nhập vào hệ thống")
.WithDescription("Xác thực người dùng bằng email và mật khẩu. "
    + "Nếu thành công, trả về thông tin user và tạo session cookie (sid) có hiệu lực 7 ngày. "
    + "Gửi thông báo đăng nhập qua SignalR real-time và Kafka event.")
.WithTags("Auth - Xác thực");

app.MapGet("/api/auth/me", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    if (!httpContext.Request.Cookies.TryGetValue("sid", out var sessionId) || string.IsNullOrEmpty(sessionId))
    {
        return Results.Ok(ApiResponse<UserDto?>.Ok(null, "Chưa đăng nhập."));
    }

    var session = await dbContext.UserSessions
        .AsNoTracking()
        .Include(s => s.User)
        .FirstOrDefaultAsync(s => s.SessionId == sessionId && s.ExpiresAt > DateTime.UtcNow);

    if (session == null)
    {
        return Results.Ok(ApiResponse<UserDto?>.Ok(null, "Phiên đăng nhập đã hết hạn."));
    }

    var user = session.User;
    var userDto = new UserDto(
        user?.Id ?? session.Id,
        session.Email,
        session.FullName,
        user?.PhoneNumber,
        user?.Address,
        user?.Role ?? "Customer",
        session.SessionId
    );

    return Results.Ok(ApiResponse<UserDto>.Ok(userDto));
})
.WithName("GetCurrentUser")
.WithSummary("Lấy thông tin người dùng hiện tại")
.WithDescription("Kiểm tra session cookie (sid) để xác định người dùng đang đăng nhập. "
    + "Trả về thông tin user nếu session còn hiệu lực, hoặc null nếu chưa đăng nhập / session hết hạn.")
.WithTags("Auth - Xác thực");

app.MapPut("/api/auth/profile", async (UpdateProfileRequest request, HttpContext httpContext, AppDbContext dbContext) =>
{
    User? user = null;
    UserSession? session = null;

    if (httpContext.Request.Cookies.TryGetValue("sid", out var sessionId) && !string.IsNullOrEmpty(sessionId))
    {
        session = await dbContext.UserSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.SessionId == sessionId && s.ExpiresAt > DateTime.UtcNow);
        user = session?.User;
    }

    if (user == null)
    {
        return Results.Json(ApiResponse<string>.Fail("Bạn cần đăng nhập để cập nhật thông tin cá nhân."), statusCode: StatusCodes.Status401Unauthorized);
    }

    if (!string.IsNullOrWhiteSpace(request.FullName)) { user.FullName = request.FullName.Trim(); if (session != null) session.FullName = user.FullName; }
    if (!string.IsNullOrWhiteSpace(request.PhoneNumber)) user.PhoneNumber = request.PhoneNumber.Trim();
    if (!string.IsNullOrWhiteSpace(request.Address)) user.Address = request.Address.Trim();
    await dbContext.SaveChangesAsync();

    var userDto = new UserDto(
        user.Id,
        user.Email,
        user.FullName,
        user.PhoneNumber,
        user.Address,
        user.Role,
        session?.SessionId ?? Guid.NewGuid().ToString("N")
    );
    return Results.Ok(ApiResponse<UserDto>.Ok(userDto, "Cập nhật địa chỉ nhận hàng và thông tin thành công."));
})
.WithName("UpdateProfile")
.WithSummary("Cập nhật thông tin cá nhân và địa chỉ nhận hàng")
.WithDescription("Cập nhật tên, số điện thoại và địa chỉ giao hàng của người dùng đang đăng nhập. "
    + "Xác định user qua session cookie (sid). Trả về 401 nếu chưa đăng nhập hoặc session đã hết hạn.")
.WithTags("Auth - Xác thực");

app.MapPost("/api/auth/logout", async (HttpContext httpContext, AppDbContext dbContext) =>
{
    if (httpContext.Request.Cookies.TryGetValue("sid", out var sessionId) && !string.IsNullOrEmpty(sessionId))
    {
        var session = await dbContext.UserSessions.FirstOrDefaultAsync(s => s.SessionId == sessionId);
        if (session != null)
        {
            dbContext.UserSessions.Remove(session);
            await dbContext.SaveChangesAsync();
        }
    }
    httpContext.Response.Cookies.Delete("sid");
    return Results.Ok(ApiResponse<string>.Ok("Đã đăng xuất thành công."));
})
.WithName("Logout")
.WithSummary("Đăng xuất khỏi hệ thống")
.WithDescription("Xóa session khỏi database và xóa cookie sid. "
    + "Sau khi đăng xuất, mọi request tiếp theo sẽ không được xác thực cho đến khi đăng nhập lại.")
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

app.MapGet("/api/products", async (Guid? categoryId, string? search, int? page, int? pageSize, IMediator mediator) =>
{
    var result = await mediator.Send(new ListProductsQuery(categoryId, search, page, pageSize));
    return Results.Ok(result);
})
.WithName("ListProducts")
.WithSummary("Lấy danh sách sản phẩm với bộ lọc và phân trang")
.WithDescription("Trả về danh sách sản phẩm có hỗ trợ: lọc theo danh mục (categoryId), "
    + "tìm kiếm theo tên/mô tả (search), phân trang (page, pageSize). "
    + "Kết quả được cache 10 phút. Mặc định sắp xếp theo ngày tạo mới nhất.")
.WithTags("Products - Sản phẩm");

app.MapGet("/api/products/{id:guid}", async (Guid id, IMediator mediator) =>
{
    var result = await mediator.Send(new GetProductDetailQuery(id));
    return result.Success ? Results.Ok(result) : Results.NotFound(result);
})
.WithName("GetProductDetail")
.WithSummary("Xem chi tiết một sản phẩm")
.WithDescription("Trả về thông tin chi tiết sản phẩm bao gồm: tên, giá, mô tả, hình ảnh, "
    + "tồn kho khả dụng (Stock - ReservedStock), danh sách đánh giá (evaluations), "
    + "rating trung bình và số lượng review. Trả về 404 nếu không tìm thấy.")
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
// MODULE 5: CART - Giỏ hàng
// ==========================================

app.MapGet("/api/cart", async (Guid? userId, string? sessionId, IMediator mediator) =>
{
    var result = await mediator.Send(new GetCartQuery(userId, sessionId));
    return Results.Ok(result);
})
.WithName("GetCart")
.WithSummary("Lấy giỏ hàng hiện tại")
.WithDescription("Trả về giỏ hàng của người dùng (theo userId) hoặc khách vãng lai (theo sessionId). "
    + "Nếu giỏ hàng chưa tồn tại, tự động tạo mới. "
    + "Trả về danh sách sản phẩm, số lượng, đơn giá và tổng tiền.")
.WithTags("Cart - Giỏ hàng");

app.MapPost("/api/cart/items", async (AddToCartCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("AddToCart")
.WithSummary("Thêm sản phẩm vào giỏ hàng")
.WithDescription("Thêm sản phẩm vào giỏ hàng với số lượng chỉ định. "
    + "Nếu sản phẩm đã có trong giỏ, số lượng sẽ được cộng dồn. "
    + "Kiểm tra tồn kho khả dụng (Stock - ReservedStock) trước khi thêm. "
    + "Trả về lỗi nếu sản phẩm không tồn tại hoặc hết hàng.")
.WithTags("Cart - Giỏ hàng");

app.MapPut("/api/cart/items/{id:guid}", async (Guid id, UpdateCartItemCommand command, IMediator mediator) =>
{
    var cmd = command with { ItemId = id };
    var result = await mediator.Send(cmd);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("UpdateCartItem")
.WithSummary("Cập nhật số lượng sản phẩm trong giỏ hàng")
.WithDescription("Thay đổi số lượng của một sản phẩm trong giỏ hàng. "
    + "Nếu số lượng ≤ 0, sản phẩm sẽ bị xóa khỏi giỏ hàng. "
    + "Trả về lỗi nếu không tìm thấy sản phẩm trong giỏ.")
.WithTags("Cart - Giỏ hàng");

app.MapDelete("/api/cart/items/{id:guid}", async (Guid id, IMediator mediator) =>
{
    var result = await mediator.Send(new RemoveCartItemCommand(id));
    return Results.Ok(result);
})
.WithName("RemoveCartItem")
.WithSummary("Xóa sản phẩm khỏi giỏ hàng")
.WithDescription("Xóa hoàn toàn một sản phẩm ra khỏi giỏ hàng theo ID của cart item. "
    + "Hoạt động idempotent: nếu item không tồn tại, vẫn trả về thành công.")
.WithTags("Cart - Giỏ hàng");

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
// MODULE 7: ORDERS - Đơn hàng
// ==========================================

app.MapPost("/api/orders/checkout", async (CheckoutCommand command, IMediator mediator) =>
{
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(result);
})
.WithName("Checkout")
.WithSummary("Tạo đơn hàng mới và link thanh toán PayOS")
.WithDescription("Xử lý checkout với luồng: "
    + "1) Validate thông tin khách hàng và giỏ hàng; "
    + "2) Giữ chỗ kho (stock reservation) trong 15 phút; "
    + "3) Áp dụng voucher nếu có; "
    + "4) Tạo link thanh toán PayOS (QR code, chuyển khoản); "
    + "5) Gửi thông báo real-time qua SignalR. "
    + "Nếu không thanh toán trong 15 phút, kho sẽ tự động được hoàn trả bởi background worker.")
.WithTags("Orders - Đơn hàng");

app.MapGet("/api/orders/history", async (Guid? userId, string? email, IMediator mediator) =>
{
    var result = await mediator.Send(new GetOrderHistoryQuery(userId, email));
    return Results.Ok(result);
})
.WithName("GetOrderHistory")
.WithSummary("Xem lịch sử đơn hàng")
.WithDescription("Trả về tối đa 20 đơn hàng gần nhất của người dùng, sắp xếp theo ngày tạo mới nhất. "
    + "Lọc theo userId hoặc email. Bao gồm chi tiết sản phẩm và lịch sử trạng thái đơn hàng.")
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
