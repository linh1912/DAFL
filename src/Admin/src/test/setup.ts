import '@testing-library/jest-dom';

// Global mocks for jsdom test environment
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

(globalThis as any).IntersectionObserver = class IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
};
