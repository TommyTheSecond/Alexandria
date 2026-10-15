import type { Book } from './types.js';

export function pdfFileName(book: Book): string {
  const title = book.meta?.title?.trim() ?? '';
  let surname = '';
  if (book.meta?.authors && book.meta.authors.length > 0) {
    const firstAuthor = book.meta.authors[0].name.trim();
    if (firstAuthor) {
      if (firstAuthor.includes(',')) {
        surname = firstAuthor.split(',')[0].trim();
      } else {
        const parts = firstAuthor.split(/\s+/);
        surname = parts[parts.length - 1];
      }
    }
  }

  const combined = surname ? `${title}-${surname}` : title;
  // Apply NFKD and strip diacritics
  const stripped = combined.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // Keep [A-Za-z0-9-] and collapse repeated -
  const cleaned = stripped
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Cut to 80 characters
  const truncated = cleaned.slice(0, 80).replace(/-+$/, '');

  if (!truncated) {
    return `book-${book.id}.pdf`;
  }
  return `${truncated}.pdf`;
}
