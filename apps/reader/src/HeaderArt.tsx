import data from './header-art.json';
import { libraryPalette } from './library-art';

const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';
function rows(source:string[]) {
  return source.map(row => {
    const runs:{tone:number;text:string}[]=[];
    for(const value of row) {
      const tone=alphabet.indexOf(value);
      const glyph=tone<0?' ':tone<18?'@':tone<34?'#':tone<48?'+':':';
      const last=runs[runs.length-1];
      if(last?.tone===tone) last.text+=glyph;
      else runs.push({tone,text:glyph});
    }
    return runs;
  });
}
const title=rows(data.title);
function Illustration({art}:{art:ReturnType<typeof rows>}) {
  return <pre aria-hidden="true">{art.map((line,y) => <span key={y}>{line.map((run,i) => <span key={i} style={{color:libraryPalette[run.tone]}}>{run.text}</span>)}{'\n'}</span>)}</pre>;
}
export function HeaderArt() {
  return <div className="header-art-row">
    <h1 className="wordmark"><a href="#/" aria-label="Alexandria"><span className="title-volume"><Illustration art={title}/></span></a></h1>
  </div>;
}
