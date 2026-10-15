import { useEffect, useRef, useState } from 'preact/hooks';
import { libraryPalette, libraryShading } from './library-art';

export function HeaderLibrary() {
  const canvas=useRef<HTMLCanvasElement>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const controller=new AbortController();
    let raf=0,previous=-1,disposed=false;
    let data:Uint8Array|undefined,cols=0,rows=0,frames=0;
    const draw=()=>{
      raf=0;
      if(!data||!canvas.current||reduced.matches) return;
      const frame=Math.floor(Math.max(0,scrollY)/8)%frames;
      if(frame===previous) return;
      previous=frame;
      const ctx=canvas.current.getContext('2d');if(!ctx)return;
      ctx.clearRect(0,0,canvas.current.width,canvas.current.height);
      ctx.font='bold 10px monospace';ctx.textBaseline='top';
      const offset=8+frame*cols*rows;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const n=data[offset+y*cols+x];if(n===255)continue;
        ctx.fillStyle=libraryPalette[n];ctx.fillText(n<12?'@':n<26?'#':n<42?'+':':',x*6,y*10.6);
      }
      canvas.current.dataset.frame=String(frame);
    };
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(draw);};
    const preference=()=>{setReady(!!data&&!reduced.matches);previous=-1;schedule();};
    fetch('./library-turntable.bin',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('Unavailable');
      const buffer=await response.arrayBuffer();if(disposed||!canvas.current)return;
      if(buffer.byteLength<8)throw Error('Invalid model');
      const h=new DataView(buffer);cols=h.getUint16(0,true);rows=h.getUint16(2,true);frames=h.getUint16(4,true);
      if(!cols||!rows||!frames||buffer.byteLength!==8+cols*rows*frames)throw Error('Invalid model');
      data=new Uint8Array(buffer);canvas.current.width=cols*6;canvas.current.height=Math.ceil(rows*10.6);
      preference();
    }).catch(()=>{/* Static ASCII remains available. */});
    addEventListener('scroll',schedule,{passive:true});reduced.addEventListener('change',preference);
    return()=>{disposed=true;controller.abort();cancelAnimationFrame(raf);removeEventListener('scroll',schedule);reduced.removeEventListener('change',preference);};
  },[]);
  return <>
    <canvas ref={canvas} data-testid="header-library-model" hidden={!ready} aria-hidden="true"/>
    <pre hidden={ready} aria-hidden="true">{libraryShading.map((line,y)=><span key={y}>{line.map((run,i)=><span key={i} style={{color:libraryPalette[run.tone]}}>{run.text}</span>)}{'\n'}</span>)}</pre>
  </>;
}
