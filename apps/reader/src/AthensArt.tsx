import source from './athens-art.json';
import { asciiRows, libraryPalette } from './library-art';
const art=asciiRows(source);
export function AthensArt() {
  return <div data-testid="library-art" className="athens-art"><pre aria-hidden="true">{art.map((line,y)=><span key={y}>{line.map((run,i)=><span key={i} style={{color:libraryPalette[run.tone]}}>{run.text}</span>)}{'\n'}</span>)}</pre></div>;
}
