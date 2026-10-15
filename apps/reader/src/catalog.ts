// Local reader view of the catalog; shared SDK types remain owned by the G0 RFC.
export interface CatalogBook {
  id: number;
  status: string;
  pdfCid?: string;
  pdfSha256?: string;
  meta: {
    title: string;
    authors: { name: string }[];
    firstPublishedYear?: number;
    description?: string;
    publicDomain?: { sourceUrl: string; sourceName: string };
    bans: { country: string; scope: string; year?: number; authority?: string; sourceUrl?: string }[];
  } | null;
}
export function filterBooks(books: CatalogBook[], query: string, country: string, scope: string) {
  const search = query.trim().toLocaleLowerCase();
  return books.filter(book => ['approved', 'flagged'].includes(book.status)
    && (!search || `${book.meta?.title ?? ''} ${book.meta?.authors.map(a => a.name).join(' ') ?? ''}`.toLocaleLowerCase().includes(search))
    && (!country || book.meta?.bans.some(b => b.country === country))
    && (!scope || book.meta?.bans.some(b => b.scope === scope)));
}
