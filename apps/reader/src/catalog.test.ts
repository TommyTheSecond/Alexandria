import { describe, expect, it } from 'vitest';
import { filterBooks } from './catalog';
const books = [
  { id: 1, status: 'approved', meta: { title: 'First', authors: [{ name: 'Example Author' }], bans: [{ country: 'US', scope: 'school' }] } },
  { id: 2, status: 'flagged', meta: { title: '中文', authors: [{ name: 'Other' }], bans: [{ country: 'CN', scope: 'national' }] } },
  { id: 3, status: 'pending', meta: null },
];
describe('catalog filtering', () => {
  it('searches authors without case sensitivity', () => expect(filterBooks(books, 'AUTHOR', '', '').map(b => b.id)).toEqual([1]));
  it('combines country and scope', () => expect(filterBooks(books, '', 'CN', 'national').map(b => b.id)).toEqual([2]));
  it('keeps flagged books and excludes pending books', () => expect(filterBooks(books, '', '', '').map(b => b.id)).toEqual([1, 2]));
  it('handles missing metadata', () => expect(filterBooks([{ id: 4, status: 'approved', meta: null }], 'missing', '', '')).toEqual([]));
});
