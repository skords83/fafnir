import { describe, expect, test } from 'vitest';
import { paginate } from './pagination';

describe('paginate', () => {
  test('empty result set is a single, empty page', () => {
    expect(paginate(0, 1)).toEqual({ page: 1, pageSize: 50, offset: 0, totalPages: 1 });
  });

  test('computes total pages and offset for a full page size', () => {
    expect(paginate(102, 1, 50)).toEqual({ page: 1, pageSize: 50, offset: 0, totalPages: 3 });
    expect(paginate(102, 2, 50)).toEqual({ page: 2, pageSize: 50, offset: 50, totalPages: 3 });
    expect(paginate(102, 3, 50)).toEqual({ page: 3, pageSize: 50, offset: 100, totalPages: 3 });
  });

  test('clamps a requested page below 1 up to 1', () => {
    expect(paginate(102, 0, 50)).toMatchObject({ page: 1, offset: 0 });
    expect(paginate(102, -5, 50)).toMatchObject({ page: 1, offset: 0 });
  });

  test('clamps a requested page beyond the last page down to the last page', () => {
    expect(paginate(102, 99, 50)).toMatchObject({ page: 3, offset: 100 });
  });

  test('a non-integer requested page falls back to page 1', () => {
    expect(paginate(102, NaN, 50)).toMatchObject({ page: 1, offset: 0 });
  });
});
