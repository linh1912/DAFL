import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayOSGatewayView } from '../components/checkout/PayOSGatewayView';

/**
 * PayOS chi con 2 cach thanh toan: quet VietQR tai cho (mac dinh)
 * va "Mo PayOS o Tab Moi". Tab nhung cong (iframe) da bo han
 * theo quyet dinh cuoi — test nay khoa hanh vi do.
 */
describe('PayOS Gateway View (khong con tab nhung)', () => {
  const baseProps = {
    orderCode: 2611085503,
    totalAmount: 25000,
    checkoutUrl: 'https://pay.payos.vn/web/abc123',
    qrCode: '00020101021238570010A0000007270127000697042200113999999999995204000053037045405250005802VN5906DAFL6007Ha Noi620908DH 2611085503630404C2A',
    accountNumber: '0987654321',
    accountName: 'DAFL STORE',
    bin: 970422,
    paymentDescription: 'DH 2611085503',
  };

  it('TC_PAYOS_01: mac dinh hien QR VietQR + nut "Toi da chuyen khoan xong" (giua testid simulate-payos-success-btn)', () => {
    const onSimulateSuccess = vi.fn();
    render(<PayOSGatewayView {...baseProps} onSimulateSuccess={onSimulateSuccess} />);

    expect(screen.getByText('Quét mã VietQR tại chỗ')).toBeInTheDocument();
    expect(screen.getByAltText('Mã QR thanh toán đơn hàng #2611085503')).toBeInTheDocument();
    const simulateBtn = screen.getByTestId('simulate-payos-success-btn');
    expect(simulateBtn).toBeInTheDocument();
    fireEvent.click(simulateBtn);
    expect(onSimulateSuccess).toHaveBeenCalledTimes(1);
  });

  it('TC_PAYOS_02: khong con tab "Nhung Cong PayOS" va khong con iframe', () => {
    const { container } = render(<PayOSGatewayView {...baseProps} onSimulateSuccess={vi.fn()} />);

    expect(screen.queryByText('Nhúng Cổng PayOS')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payos-iframe-container')).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('TC_PAYOS_03: co nut "Mo PayOS o Tab Moi" khi co checkoutUrl that', () => {
    render(<PayOSGatewayView {...baseProps} onSimulateSuccess={vi.fn()} />);

    const newTabLink = screen.getByText('Mở PayOS ở Tab Mới');
    expect(newTabLink).toBeInTheDocument();
    expect(newTabLink.closest('a')).toHaveAttribute('href', 'https://pay.payos.vn/web/abc123');
    expect(newTabLink.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('TC_PAYOS_04: khong co link tab moi khi khong co checkoutUrl that (che do QR don thuan)', () => {
    render(<PayOSGatewayView {...baseProps} checkoutUrl={undefined} onSimulateSuccess={vi.fn()} />);

    expect(screen.queryByText('Mở PayOS ở Tab Mới')).not.toBeInTheDocument();
    expect(screen.queryByText('Nhúng Cổng PayOS')).not.toBeInTheDocument();
    expect(screen.getByTestId('simulate-payos-success-btn')).toBeInTheDocument();
  });
});
