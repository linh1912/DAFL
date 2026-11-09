import React, { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { Category } from '../../../../Shared/types';
import { shortCategoryName } from '../../utils/shops';

export interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCategories = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      cat =>
        cat.name.toLowerCase().includes(q) ||
        (cat.description && cat.description.toLowerCase().includes(q))
    );
  }, [categories, searchTerm]);

  return (
    <section data-testid="category-filter-section">
      <div className="section-title category-section-title">
        <div className="category-title-left">
          <span>Danh mục mỹ phẩm ({categories.length})</span>
          {selectedCategory && (
            <button
              className="category-clear-btn"
              onClick={() => onSelectCategory(null)}
              data-testid="clear-category-btn"
            >
              Xem tất cả
            </button>
          )}
        </div>

        {/* Category Search Input */}
        <div className="category-search-box" data-testid="category-search-box">
          <Search className="category-search-icon" size={15} />
          <input
            type="text"
            className="category-search-input"
            placeholder="Tìm danh mục..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="category-search-input"
          />
          {searchTerm && (
            <button
              type="button"
              className="category-search-clear-btn"
              onClick={() => setSearchTerm('')}
              title="Xóa tìm kiếm danh mục"
              data-testid="category-search-clear-btn"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {searchTerm && filteredCategories.length === 0 ? (
        <div className="category-empty-state" data-testid="category-empty-state">
          <span>Không tìm thấy danh mục nào phù hợp với &quot;<strong>{searchTerm}</strong>&quot;</span>
          <button
            type="button"
            className="category-pill category-empty-action"
            onClick={() => setSearchTerm('')}
          >
            Hiển thị tất cả
          </button>
        </div>
      ) : (
        <div className="categories-bar" data-testid="categories-bar">
          <button
            className={`category-pill ${selectedCategory === null ? 'active' : ''}`}
            onClick={() => onSelectCategory(null)}
            data-testid="category-pill-all"
          >
            Tất cả danh mục
          </button>
          {filteredCategories.map(cat => (
            <button
              key={cat.id}
              className={`category-pill ${selectedCategory === cat.id ? 'active' : ''}`}
              onClick={() => onSelectCategory(cat.id)}
              data-testid={`category-pill-${cat.id}`}
              title={cat.name}
            >
              {cat.iconUrl && cat.iconUrl.length <= 4 ? <span aria-hidden>{cat.iconUrl}</span> : null}
              {shortCategoryName(cat.name)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

