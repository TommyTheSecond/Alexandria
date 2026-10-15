import { writeFile } from 'node:fs/promises';
import { renderView } from './library-model.mjs';
const cols=192, rows=106, frames=60;
const bytes=new Uint8Array(8+cols*rows*frames);
const header=new DataView(bytes.buffer);
header.setUint16(0,cols,true); header.setUint16(2,rows,true); header.setUint16(4,frames,true); header.setUint16(6,1,true);
for(let i=0;i<frames;i++) {
  bytes.set(renderView(Math.atan2(9,13.5)+i/frames*Math.PI*2,cols,rows),8+i*cols*rows);
  if(i%10===0) console.log(`Rendered ${i+1}/${frames} model views`);
}
await writeFile(new URL('../public/library-turntable.bin',import.meta.url),bytes);
console.log(`Saved ${bytes.length} bytes of ASCII model views.`);
