using DAFL.Backend.Common;
using DAFL.Backend.Features.Auth;
using DAFL.Backend.Infrastructure.Data;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace DAFL.Backend.Features.Addresses;

// ==========================================
// CN-03.3 — Sổ địa chỉ giao hàng: tối đa 5 địa chỉ/tài khoản,
// địa chỉ đầu tiên tự động là mặc định; xóa mặc định → địa chỉ còn lại MỚI NHẤT lên thay;
// đúng 1 địa chỉ mặc định tại một thời điểm.
// ==========================================

public record AddressDto(
    Guid Id,
    string RecipientName,
    string Phone,
    string ProvinceCode,
    string ProvinceName,
    string DistrictCode,
    string DistrictName,
    string WardCode,
    string WardName,
    string DetailAddress,
    string? Note,
    bool IsDefault,
    DateTime CreatedAt)
{
    public static AddressDto FromEntity(UserAddress a) => new(
        a.Id, a.RecipientName, a.Phone, a.ProvinceCode, a.ProvinceName, a.DistrictCode, a.DistrictName,
        a.WardCode, a.WardName, a.DetailAddress, a.Note, a.IsDefault, a.CreatedAt);
}

public static class AddressValidation
{
    public const int MaxAddressesPerUser = 5;

    /// <summary>Validate một địa chỉ trước khi lưu; trả câu lỗi đầu tiên hoặc null.</summary>
    public static string? Validate(
        string? recipientName, string? phone,
        string? provinceCode, string? districtCode, string? wardCode,
        string? provinceName, string? districtName, string? wardName,
        string? detailAddress)
    {
        if (string.IsNullOrWhiteSpace(recipientName) || recipientName.Trim().Length < 2)
        {
            return "Tên người nhận không hợp lệ";
        }

        if (IdentityValidation.ValidatePhoneFormat(phone) is { } phoneError)
        {
            return phoneError;
        }

        if (string.IsNullOrWhiteSpace(provinceCode) || string.IsNullOrWhiteSpace(provinceName)
            || string.IsNullOrWhiteSpace(districtCode) || string.IsNullOrWhiteSpace(districtName)
            || string.IsNullOrWhiteSpace(wardCode) || string.IsNullOrWhiteSpace(wardName))
        {
            return "Vui lòng chọn đầy đủ tỉnh/thành phố, quận/huyện, phường/xã.";
        }

        if (string.IsNullOrWhiteSpace(detailAddress) || detailAddress.Trim().Length < 5)
        {
            return "Địa chỉ chi tiết phải có ít nhất 5 ký tự.";
        }

        return null;
    }
}

// 1. Danh sách địa chỉ của user (mặc định lên đầu, sau đó mới nhất trước)
public record GetAddressesQuery(Guid UserId) : IRequest<ApiResponse<List<AddressDto>>>;

public class GetAddressesQueryHandler : IRequestHandler<GetAddressesQuery, ApiResponse<List<AddressDto>>>
{
    private readonly AppDbContext _context;

    public GetAddressesQueryHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<List<AddressDto>>> Handle(GetAddressesQuery request, CancellationToken cancellationToken)
    {
        var addresses = await _context.UserAddresses
            .AsNoTracking()
            .Where(a => a.UserId == request.UserId)
            .OrderByDescending(a => a.IsDefault)
            .ThenByDescending(a => a.CreatedAt)
            .ToListAsync(cancellationToken);

        return ApiResponse<List<AddressDto>>.Ok(addresses.Select(AddressDto.FromEntity).ToList());
    }
}

// 2. Thêm địa chỉ
public record CreateAddressCommand(
    Guid UserId,
    string RecipientName,
    string Phone,
    string ProvinceCode,
    string ProvinceName,
    string DistrictCode,
    string DistrictName,
    string WardCode,
    string WardName,
    string DetailAddress,
    string? Note,
    bool SetAsDefault = false) : IRequest<ApiResponse<AddressDto>>;

public class CreateAddressCommandHandler : IRequestHandler<CreateAddressCommand, ApiResponse<AddressDto>>
{
    private readonly AppDbContext _context;

    public CreateAddressCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<AddressDto>> Handle(CreateAddressCommand request, CancellationToken cancellationToken)
    {
        if (AddressValidation.Validate(request.RecipientName, request.Phone, request.ProvinceCode, request.DistrictCode,
                request.WardCode, request.ProvinceName, request.DistrictName, request.WardName, request.DetailAddress) is { } error)
        {
            return ApiResponse<AddressDto>.Fail(error);
        }

        var existing = await _context.UserAddresses
            .Where(a => a.UserId == request.UserId)
            .ToListAsync(cancellationToken);

        if (existing.Count >= AddressValidation.MaxAddressesPerUser)
        {
            return ApiResponse<AddressDto>.Fail($"Bạn chỉ có thể lưu tối đa {AddressValidation.MaxAddressesPerUser} địa chỉ giao hàng.");
        }

        var isFirst = existing.Count == 0;
        if (request.SetAsDefault || isFirst)
        {
            foreach (var a in existing) a.IsDefault = false;
        }

        var address = new UserAddress
        {
            Id = Guid.NewGuid(),
            UserId = request.UserId,
            RecipientName = request.RecipientName.Trim(),
            Phone = request.Phone.Trim(),
            ProvinceCode = request.ProvinceCode.Trim(),
            ProvinceName = request.ProvinceName.Trim(),
            DistrictCode = request.DistrictCode.Trim(),
            DistrictName = request.DistrictName.Trim(),
            WardCode = request.WardCode.Trim(),
            WardName = request.WardName.Trim(),
            DetailAddress = request.DetailAddress.Trim(),
            Note = request.Note?.Trim(),
            IsDefault = isFirst || request.SetAsDefault,
            CreatedAt = DateTime.UtcNow
        };

        await _context.UserAddresses.AddAsync(address, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);

        return ApiResponse<AddressDto>.Ok(AddressDto.FromEntity(address), "Thêm địa chỉ thành công");
    }
}

// 3. Sửa địa chỉ
public record UpdateAddressCommand(
    Guid UserId,
    Guid AddressId,
    string RecipientName,
    string Phone,
    string ProvinceCode,
    string ProvinceName,
    string DistrictCode,
    string DistrictName,
    string WardCode,
    string WardName,
    string DetailAddress,
    string? Note) : IRequest<ApiResponse<AddressDto>>;

public class UpdateAddressCommandHandler : IRequestHandler<UpdateAddressCommand, ApiResponse<AddressDto>>
{
    private readonly AppDbContext _context;

    public UpdateAddressCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<AddressDto>> Handle(UpdateAddressCommand request, CancellationToken cancellationToken)
    {
        var address = await _context.UserAddresses
            .FirstOrDefaultAsync(a => a.Id == request.AddressId && a.UserId == request.UserId, cancellationToken);
        if (address == null)
        {
            return ApiResponse<AddressDto>.Fail("Không tìm thấy địa chỉ.");
        }

        if (AddressValidation.Validate(request.RecipientName, request.Phone, request.ProvinceCode, request.DistrictCode,
                request.WardCode, request.ProvinceName, request.DistrictName, request.WardName, request.DetailAddress) is { } error)
        {
            return ApiResponse<AddressDto>.Fail(error);
        }

        address.RecipientName = request.RecipientName.Trim();
        address.Phone = request.Phone.Trim();
        address.ProvinceCode = request.ProvinceCode.Trim();
        address.ProvinceName = request.ProvinceName.Trim();
        address.DistrictCode = request.DistrictCode.Trim();
        address.DistrictName = request.DistrictName.Trim();
        address.WardCode = request.WardCode.Trim();
        address.WardName = request.WardName.Trim();
        address.DetailAddress = request.DetailAddress.Trim();
        address.Note = request.Note?.Trim();

        await _context.SaveChangesAsync(cancellationToken);
        return ApiResponse<AddressDto>.Ok(AddressDto.FromEntity(address), "Cập nhật thành công");
    }
}

// 4. Xóa địa chỉ — xóa địa chỉ mặc định thì địa chỉ còn lại MỚI NHẤT thành mặc định
public record DeleteAddressCommand(Guid UserId, Guid AddressId) : IRequest<ApiResponse<bool>>;

public class DeleteAddressCommandHandler : IRequestHandler<DeleteAddressCommand, ApiResponse<bool>>
{
    private readonly AppDbContext _context;

    public DeleteAddressCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<bool>> Handle(DeleteAddressCommand request, CancellationToken cancellationToken)
    {
        var address = await _context.UserAddresses
            .FirstOrDefaultAsync(a => a.Id == request.AddressId && a.UserId == request.UserId, cancellationToken);
        if (address == null)
        {
            return ApiResponse<bool>.Fail("Không tìm thấy địa chỉ.");
        }

        var wasDefault = address.IsDefault;
        _context.UserAddresses.Remove(address);
        await _context.SaveChangesAsync(cancellationToken);

        if (wasDefault)
        {
            var newest = await _context.UserAddresses
                .Where(a => a.UserId == request.UserId)
                .OrderByDescending(a => a.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken);
            if (newest != null)
            {
                newest.IsDefault = true;
                await _context.SaveChangesAsync(cancellationToken);
            }
        }

        return ApiResponse<bool>.Ok(true, "Đã xóa địa chỉ.");
    }
}

// 5. Đặt địa chỉ mặc định
public record SetDefaultAddressCommand(Guid UserId, Guid AddressId) : IRequest<ApiResponse<AddressDto>>;

public class SetDefaultAddressCommandHandler : IRequestHandler<SetDefaultAddressCommand, ApiResponse<AddressDto>>
{
    private readonly AppDbContext _context;

    public SetDefaultAddressCommandHandler(AppDbContext context) => _context = context;

    public async Task<ApiResponse<AddressDto>> Handle(SetDefaultAddressCommand request, CancellationToken cancellationToken)
    {
        var addresses = await _context.UserAddresses
            .Where(a => a.UserId == request.UserId)
            .ToListAsync(cancellationToken);

        var target = addresses.FirstOrDefault(a => a.Id == request.AddressId);
        if (target == null)
        {
            return ApiResponse<AddressDto>.Fail("Không tìm thấy địa chỉ.");
        }

        foreach (var a in addresses) a.IsDefault = a.Id == target.Id;
        await _context.SaveChangesAsync(cancellationToken);

        return ApiResponse<AddressDto>.Ok(AddressDto.FromEntity(target), "Đã đặt làm địa chỉ mặc định.");
    }
}
