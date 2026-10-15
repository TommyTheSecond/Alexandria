// Original, stylized Hellenistic library model. This is an imagined exterior,
// not a claim about the lost library's historically exact architecture.

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';
const add = (a,b) => a.map((v,i) => v+b[i]);
const mul = (a,k) => a.map(v => v*k);
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((s,v,i) => s+v*b[i],0);
const norm = a => mul(a,1/Math.hypot(...a));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function box(x,y,z,bx,by,bz) {
  const q = [Math.abs(x)-bx,Math.abs(y)-by,Math.abs(z)-bz];
  return Math.hypot(...q.map(v=>Math.max(v,0)))+Math.min(Math.max(...q),0);
}
function scene([x,y,z]) {
  let d = box(x,y-.12,z,5.1,.12,3.1);
  d = Math.min(d,box(x,y-.36,z,4.8,.12,2.8),box(x,y-.60,z,4.5,.12,2.5));
  // Recessed main hall and its dark entrance.
  const hall = box(x,y-2.5,z+.7,3.8,1.8,1.3);
  const door = box(x,y-1.8,z-.6,.75,1.12,.45);
  d = Math.min(d,Math.max(hall,-door));
  for (const cx of [-3.6,-2.16,-.72,.72,2.16,3.6]) {
    for (const cz of [2,-2]) {
      const radius = .235 + (4.1-y)*.008;
      const cylinder = Math.max(Math.hypot(x-cx,z-cz)-radius,Math.abs(y-2.55)-1.7);
      d = Math.min(d,cylinder,box(x-cx,y-.85,z-cz,.37,.13,.37),box(x-cx,y-4.25,z-cz,.39,.15,.39));
    }
  }
  // Entablature, projecting cornices and a solid triangular pediment.
  d = Math.min(d,box(x,y-4.6,z,4.28,.2,2.43),box(x,y-4.87,z,4.46,.08,2.58));
  const roof = Math.max((Math.abs(x)*.36+y-6.47)/1.063,4.95-y,Math.abs(z)-2.48);
  d = Math.min(d,roof);
  // A slightly recessed triangular panel creates depth in the front pediment.
  const panel = Math.max((Math.abs(x)*.36+y-6.17)/1.063,5.13-y,Math.abs(z-2.48)-.09);
  if (y>5) d = Math.max(d,-panel);
  return d;
}

const light=norm([-5,9,7]);
function shade(ro,rd) {
  let t=0, p;
  for(let i=0;i<100;i++) {
    p=add(ro,mul(rd,t));
    const d=scene(p);
    if(d<.008) break;
    t+=d*.85;
    if(t>35) return -1;
    if(i===99) return -1;
  }
  const e=.014;
  const n=norm([scene(add(p,[e,0,0]))-scene(add(p,[-e,0,0])),scene(add(p,[0,e,0]))-scene(add(p,[0,-e,0])),scene(add(p,[0,0,e]))-scene(add(p,[0,0,-e]))]);
  let shadow=1, st=.07;
  for(let i=0;i<25;i++) {
    const d=scene(add(add(p,mul(n,.035)),mul(light,st)));
    if(d<.005) { shadow=.16; break; }
    shadow=Math.min(shadow,12*d/st);
    st+=Math.max(.045,d);
    if(st>12) break;
  }
  const diffuse=Math.max(0,dot(n,light));
  const ao=Math.min(1,scene(add(p,mul(n,.28)))/.28);
  let value=.2+.62*diffuse*Math.max(.16,shadow)+.12*Math.max(0,n[1]);
  value*=.65+.35*ao;
  // Subtle stone joints and column fluting give broad planes a readable texture.
  if(p[1]>1&&p[1]<4.1) value*=.94+.06*Math.cos(p[0]*42+p[2]*20);
  return Math.max(0,Math.min(1,value));
}
export function renderView(angle, cols=192, rows=106) {
  const camera=[Math.sin(angle)*16.2,6.7,Math.cos(angle)*16.2], target=[0,2.7,0];
  const forward=norm(sub(target,camera)), right=norm(cross(forward,[0,1,0])), up=cross(right,forward);
  const output=new Uint8Array(cols*rows);
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) {
    const u=((x+.5)/cols-.5)*.75;
    const v=(.5-(y+.5)/rows)*.75;
    const rd=norm(add(forward,add(mul(right,u),mul(up,v))));
    const value=shade(camera,rd);
    output[y*cols+x]=value<0?255:Math.round(value*63);
  }
  return output;
}