using DAFL.Backend.Common;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Auth;

// ==========================================
// CN-03. Quản lý thông tin cá nhân (đã đăng nhập bằng JWT)
// ==========================================

// 3.1 Cập nhật hồ sơ: sửa được họ tên + SĐT; email chỉ đọc, không sửa qua endpoint này
public record UpdateProfileCommand(Guid UserId, string? FullName, string? PhoneNumber, string? Address)
    : IRequest<ApiResponse<UserDto>>;

public class UpdateProfileCommandHandler : IRequestHandler<UpdateProfileCommand, ApiResponse<UserDto>>
{
    private readonly AppDbContext _context;

    public UpdateProfileCommandHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<UserDto>> Handle(UpdateProfileCommand request, CancellationToken cancellationToken)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user == null)
        {
            return ApiResponse<UserDto>.Fail("Không tìm thấy tài khoản.");
        }

        if (request.FullName != null)
        {
            if (IdentityValidation.ValidateFullName(request.FullName) is { } nameError)
            {
                return ApiResponse<UserDto>.Fail(nameError);
            }
            user.FullName = request.FullName.Trim();
        }

        if (request.PhoneNumber != null)
        {
            var phone = request.PhoneNumber.Trim();
            if (IdentityValidation.ValidatePhoneFormat(phone) is { } phoneError)
            {
                return ApiResponse<UserDto>.Fail(phoneError);
            }

            // CN-03.1: SĐT trùng với tài khoản KHÁC → lỗi như đăng ký
            if (await _context.Users.AnyAsync(u => u.PhoneNumber == phone && u.Id != user.Id, cancellationToken))
            {
                return ApiResponse<UserDto>.Fail("Số điện thoại đã được sử dụng");
            }
            user.PhoneNumber = phone;
        }

        if (request.Address != null)
        {
            user.Address = request.Address.Trim();
        }

        await _context.SaveChangesAsync(cancellationToken);

        var dto = await AuthTokenFactory.BuildUserDtoAsync(_context, user, cancellationToken);
        return ApiResponse<UserDto>.Ok(dto, "Cập nhật thành công");
    }
}

// 3.2 Đổi mật khẩu: kiểm tra mật khẩu hiện tại, mật khẩu mới theo policy nghiêm ngặt và phải khác mật khẩu cũ
public record ChangePasswordCommand(Guid UserId, string CurrentPassword, string NewPassword, string? ConfirmNewPassword)
    : IRequest<ApiResponse<string>>;

public class ChangePasswordCommandHandler : IRequestHandler<ChangePasswordCommand, ApiResponse<string>>
{
    private readonly AppDbContext _context;

    public ChangePasswordCommandHandler(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ApiResponse<string>> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user == null)
        {
            return ApiResponse<string>.Fail("Không tìm thấy tài khoản.");
        }

        if (string.IsNullOrEmpty(user.PasswordHash))
        {
            return ApiResponse<string>.Fail("Tài khoản chưa có mật khẩu. Vui lòng dùng chức năng đặt mật khẩu.");
        }

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword ?? string.Empty, user.PasswordHash))
        {
            return ApiResponse<string>.Fail("Mật khẩu hiện tại không đúng");
        }

        var passwordError = PasswordPolicy.Validate(request.NewPassword);
        if (passwordError != null)
        {
            return ApiResponse<string>.Fail(passwordError);
        }

        if (BCrypt.Net.BCrypt.Verify(request.NewPassword, user.PasswordHash))
        {
            return ApiResponse<string>.Fail("Mật khẩu mới không được trùng với mật khẩu cũ.");
        }

        if (!string.IsNullOrEmpty(request.ConfirmNewPassword) && request.ConfirmNewPassword != request.NewPassword)
        {
            return ApiResponse<string>.Fail("Mật khẩu xác nhận không khớp");
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        // Vô hiệu mọi JWT đang sống (tài liệu §2.2): TokenVersion tăng → middleware từ chối token cũ.
        user.TokenVersion++;
        await _context.SaveChangesAsync(cancellationToken);

        return ApiResponse<string>.Ok("Đổi mật khẩu thành công. Vui lòng đăng nhập lại trên mọi thiết bị.");
    }
}
