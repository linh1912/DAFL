import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryFilter } from '../components/product/CategoryFilter';
import { Header } from '../components/common/Header';
import { Category } from '../../../Shared/types';

describe('Search & Filter Module', () => {
  const mockCategories: Category[] = [
    { id: 'cat-1', name: 'Điện thoại & Tablet', slug: 'dien-thoai', iconUrl: '📱' },
    { id: 'cat-2', name: 'Thời trang nam', slug: 'thoi-trang-nam', iconUrl: '👕' },
    { id: 'cat-3', name: 'Đồ gia dụng', slug: 'do-gia-dung', iconUrl: '🍳' },
  ];

  // ==========================================
  // Positive Path Test Cases (70%)
  // ==========================================
  it('TC_SEARCH_01: Should render search input field in Header with proper placeholder', () => {
    const setSearchQuery = vi.fn();
    render(
      <Header
        searchQuery=""
        setSearchQuery={setSearchQuery}
        onNavigate={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
        unreadCount={0}
        onToggleNotif={vi.fn()}
        user={null}
        profileFullName="Demo"
        isAccountDropdownOpen={false}
        setIsAccountDropdownOpen={vi.fn()}
        accountDropdownRef={{ current: null }}
        onLogout={vi.fn()}
        onOpenAuth={vi.fn()}
        totalItemCount={0}
        onOpenCart={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('search-input');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', expect.stringContaining('Tìm son'));
  });

  it('TC_SEARCH_02: Should trigger setSearchQuery when typing keyword', () => {
    const setSearchQuery = vi.fn();
    render(
      <Header
        searchQuery=""
        setSearchQuery={setSearchQuery}
        onNavigate={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
        unreadCount={0}
        onToggleNotif={vi.fn()}
        user={null}
        profileFullName="Demo"
        isAccountDropdownOpen={false}
        setIsAccountDropdownOpen={vi.fn()}
        accountDropdownRef={{ current: null }}
        onLogout={vi.fn()}
        onOpenAuth={vi.fn()}
        totalItemCount={0}
        onOpenCart={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'iPhone 15' } });
    expect(setSearchQuery).toHaveBeenCalledWith('iPhone 15');
  });

  it('TC_SEARCH_03: Should render clear search button when query is not empty and clear on click', () => {
    const setSearchQuery = vi.fn();
    render(
      <Header
        searchQuery="MacBook"
        setSearchQuery={setSearchQuery}
        onNavigate={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
        unreadCount={0}
        onToggleNotif={vi.fn()}
        user={null}
        profileFullName="Demo"
        isAccountDropdownOpen={false}
        setIsAccountDropdownOpen={vi.fn()}
        accountDropdownRef={{ current: null }}
        onLogout={vi.fn()}
        onOpenAuth={vi.fn()}
        totalItemCount={0}
        onOpenCart={vi.fn()}
      />
    );

    const clearBtn = screen.getByTestId('search-clear-btn');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });

  it('TC_FILTER_01: Should render all category pills and "Tất cả danh mục" button', () => {
    render(
      <CategoryFilter
        categories={mockCategories}
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );

    expect(screen.getByTestId('category-pill-all')).toHaveClass('active');
    expect(screen.getByTestId('category-pill-cat-1')).toHaveTextContent('Điện thoại');
    expect(screen.getByTestId('category-pill-cat-2')).toHaveTextContent('Thời trang nam');
    expect(screen.getByTestId('category-pill-cat-3')).toHaveTextContent('Đồ gia dụng');
  });

  it('TC_FILTER_02: Should call onSelectCategory with category id when clicked', () => {
    const onSelectCategory = vi.fn();
    render(
      <CategoryFilter
        categories={mockCategories}
        selectedCategory={null}
        onSelectCategory={onSelectCategory}
      />
    );

    const cat1Btn = screen.getByTestId('category-pill-cat-1');
    fireEvent.click(cat1Btn);
    expect(onSelectCategory).toHaveBeenCalledWith('cat-1');
  });

  it('TC_FILTER_03: Should show "Xem tất cả" button when a category is selected and reset on click', () => {
    const onSelectCategory = vi.fn();
    render(
      <CategoryFilter
        categories={mockCategories}
        selectedCategory="cat-1"
        onSelectCategory={onSelectCategory}
      />
    );

    const clearCatBtn = screen.getByTestId('clear-category-btn');
    expect(clearCatBtn).toBeInTheDocument();
    fireEvent.click(clearCatBtn);
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it('TC_FILTER_04: Should filter category pills when typing in category search box', () => {
    render(
      <CategoryFilter
        categories={mockCategories}
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('category-search-input');
    expect(searchInput).toBeInTheDocument();

    // Type "Điện thoại"
    fireEvent.change(searchInput, { target: { value: 'Điện thoại' } });

    expect(screen.getByTestId('category-pill-cat-1')).toBeInTheDocument();
    expect(screen.queryByTestId('category-pill-cat-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('category-pill-cat-3')).not.toBeInTheDocument();

    // Clear search using clear button
    const clearBtn = screen.getByTestId('category-search-clear-btn');
    fireEvent.click(clearBtn);

    expect(screen.getByTestId('category-pill-cat-1')).toBeInTheDocument();
    expect(screen.getByTestId('category-pill-cat-2')).toBeInTheDocument();
    expect(screen.getByTestId('category-pill-cat-3')).toBeInTheDocument();
  });

  it('TC_FILTER_05: Should show empty state when no category matches search query', () => {
    render(
      <CategoryFilter
        categories={mockCategories}
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('category-search-input');
    fireEvent.change(searchInput, { target: { value: 'KhôngTồnTại123' } });

    expect(screen.getByTestId('category-empty-state')).toBeInTheDocument();
  });

  // ==========================================
  // Negative Path Test Cases (30%)
  // ==========================================
  it('TC_SEARCH_04: Should not show clear search button when search query is empty', () => {
    render(
      <Header
        searchQuery=""
        setSearchQuery={vi.fn()}
        onNavigate={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
        unreadCount={0}
        onToggleNotif={vi.fn()}
        user={null}
        profileFullName="Demo"
        isAccountDropdownOpen={false}
        setIsAccountDropdownOpen={vi.fn()}
        accountDropdownRef={{ current: null }}
        onLogout={vi.fn()}
        onOpenAuth={vi.fn()}
        totalItemCount={0}
        onOpenCart={vi.fn()}
      />
    );

    expect(screen.queryByTestId('search-clear-btn')).not.toBeInTheDocument();
  });

  it('TC_FILTER_04: Should render gracefully when category list is empty', () => {
    render(
      <CategoryFilter
        categories={[]}
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );

    expect(screen.getByTestId('category-pill-all')).toBeInTheDocument();
    expect(screen.queryByTestId('clear-category-btn')).not.toBeInTheDocument();
  });
});
