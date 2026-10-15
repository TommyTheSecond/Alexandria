import type { Book, ScanReport } from '@alexandria/sdk';

interface Props {
  item: Book;
  report: ScanReport | null | undefined;
  reportUrl: (cid: string | null | undefined) => string | undefined;
  busy: boolean;
  onDownload: () => void;
  onReview: (id: number, approve: boolean) => void;
}

export function PendingCard({ item, report, reportUrl, busy, onDownload, onReview }: Props) {
  const source = item.meta?.publicDomain.sourceUrl;
  const failed = report?.checks.filter(check => !check.passed) ?? [];
  return <article className="pending-book">
    <h3>#{item.id} {item.meta?.title ?? 'Metadata unavailable'} {report && `· scan score ${report.score}`}</h3>
    <p>{item.meta?.authors.map(author => author.name).join(', ')}</p>
    {source && /^https:\/\//i.test(source) && <p><a href={source}>Public-domain source</a></p>}
    {reportUrl(item.metaCid) && <p><a href={reportUrl(item.metaCid)} target="_blank" rel="noopener noreferrer">View metadata</a></p>}
    {reportUrl(item.meta?.scanReportCid) ? <p><a href={reportUrl(item.meta?.scanReportCid)} target="_blank" rel="noopener noreferrer">Open scan report</a></p>
      : <p>No scan report is attached. Scan this file manually before approval.</p>}
    {failed.length > 0 && <ul>{failed.map(check => <li key={check.id}>{check.id}: {check.detail}</li>)}</ul>}
    <button type="button" disabled={busy} onClick={onDownload}>Download verified PDF for review</button>
    <label>Review reason<input id={`reason-${item.id}`} maxLength={300} /></label>
    <button type="button" disabled={busy || !item.meta} onClick={() => onReview(item.id, true)}>Approve</button>
    <button type="button" disabled={busy} onClick={() => onReview(item.id, false)}>Reject</button>
  </article>;
}
