import source from './justice-art.json';
import { asciiRows, libraryPalette } from './library-art';

const art = asciiRows(source);

export function LadyJustice() {
  return <pre aria-hidden="true">{art.map((line, y) => <span key={y}>{line.map((run, i) =>
    <span key={i} style={{ color: libraryPalette[run.tone] }}>{run.text}</span>
  )}{'\n'}</span>)}</pre>;
}
