import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { candidates } from './political-candidates.mjs';

const root=new URL('../public/political/',import.meta.url);
await mkdir(root,{recursive:true});
const limit=50, maxBytes=31457280;
let nextRequest=0;
async function request(url) {
  const wait=Math.max(0,nextRequest-Date.now());
  nextRequest=Math.max(Date.now(),nextRequest)+1150;
  if(wait) await new Promise(r=>setTimeout(r,wait));
  const response=await fetch(url,{headers:{'User-Agent':'Alexandria-Hackathon-Research/1.0 (public-domain historical scans)'},signal:AbortSignal.timeout(120000)});
  if(!response.ok) throw Error(`HTTP ${response.status}`);
  return response;
}
const text=v=>Array.isArray(v)?v.join('; '):String(v??'');
const normal=v=>text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const ledgerUrl=new URL('sources.json',root);
let ledger=[];
try {ledger=JSON.parse(await readFile(ledgerUrl,'utf8'));}catch{}
const failures=[];
async function save() {
  await writeFile(ledgerUrl,JSON.stringify(ledger,null,2));
  const books=ledger.map((record,i)=>({id:1001+i,status:'local',sampleFile:`./political/${record.slug}.pdf`,pdfSha256:record.sha256,meta:{
    title:record.workTitle,authors:[{name:record.author,deathYear:record.deathYear}],firstPublishedYear:record.firstPublishedYear,
    description:`Political reading collection. Historical ${record.editionYear} scan: ${record.scanTitle}. ${record.pages?'Source page count: '+record.pages+'. ':''}Not scanner-cleared, curator-approved or on-chain. Ban history has not been researched.`,
    publicDomain:{sourceName:'Internet Archive historical scan',sourceUrl:record.sourceUrl},bans:[],
  }}));
  await writeFile(new URL('catalog.json',root),JSON.stringify({source:'local',label:'Political reading collection',books},null,2));
  await writeFile(new URL('failures.json',root),JSON.stringify(failures,null,2));
}
for(const candidate of candidates) {
  if(ledger.length>=limit)break;
  if(ledger.some(r=>r.slug===candidate.slug))continue;
  console.log(`[${ledger.length}/${limit}] Searching ${candidate.title} (${candidate.author})`);
  try {
    const words=normal(candidate.title).split(' ').filter(w=>w.length>2&&!['the','and','with','for','from'].includes(w));
    const query=`title:(${words.map(w=>`"${w}"`).join(' AND ')}) AND creator:("${candidate.surname}") AND mediatype:texts AND language:eng AND year:[${Math.max(1500,candidate.year)} TO 1930] AND NOT collection:inlibrary AND NOT access-restricted-item:true`;
    const url=new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q',query);url.searchParams.set('rows','8');url.searchParams.set('output','json');url.searchParams.set('sort[]','downloads desc');
    for(const field of ['identifier','title','creator','date','language'])url.searchParams.append('fl[]',field);
    const search=await (await request(url)).json();
    let choices=search.response.docs;
    choices.sort((a,b)=>{
      const score=d=>Math.abs(normal(d.title).length-normal(candidate.title).length)+(normal(d.title).includes('works')?50:0);
      return score(a)-score(b);
    });
    let found=false;
    for(const choice of choices.slice(0,5)) {
      if(ledger.some(r=>r.archiveId===choice.identifier))continue;
      const metadata=await (await request(`https://archive.org/metadata/${choice.identifier}`)).json();
      const m=metadata.metadata;
      if(m['access-restricted-item']==='true')continue;
      const year=Number(text(m.date).match(/\b(1[5-9]\d\d)\b/)?.[1]);
      if(!year||year<candidate.year||year>1930)continue;
      const pdfs=metadata.files.filter(f=>/\.pdf$/i.test(f.name)&&!f.private&&Number(f.size)>10000&&Number(f.size)<=maxBytes);
      pdfs.sort((a,b)=>Number(a.size)-Number(b.size));
      for(const pdf of pdfs.slice(0,2)) {
        const download=`https://archive.org/download/${choice.identifier}/${encodeURIComponent(pdf.name)}`;
        try {
          console.log(`  Downloading ${choice.identifier}/${pdf.name} (${Math.round(Number(pdf.size)/1024/1024)} MB)`);
          const bytes=Buffer.from(await (await request(download)).arrayBuffer());
          if(bytes.length>maxBytes||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==Number(pdf.size))throw Error('PDF size/magic mismatch');
          const sha256='0x'+createHash('sha256').update(bytes).digest('hex');
          if(ledger.some(r=>r.sha256===sha256))throw Error('Duplicate PDF');
          await writeFile(new URL(`${candidate.slug}.pdf`,root),bytes);
          const record={slug:candidate.slug,workTitle:candidate.title,author:candidate.author,deathYear:candidate.deathYear,firstPublishedYear:candidate.year,scanTitle:text(m.title),scanCreators:m.creator,editionYear:year,publisher:m.publisher,language:m.language,archiveId:choice.identifier,filename:pdf.name,sourceUrl:`https://archive.org/details/${choice.identifier}`,downloadUrl:download,bytes:bytes.length,sha256,pages:Number(m.imagecount)||null,reviewStatus:'needs-human-review',retrievedAt:new Date().toISOString()};
          ledger.push(record);await save();found=true;
          console.log(`  SAVED ${ledger.length}/${limit}: ${candidate.title}`);break;
        }catch(error){console.log(`  File skipped: ${error.message}`);}
      }
      if(found)break;
    }
    if(!found){failures.push({title:candidate.title,reason:'No suitable downloadable historical PDF found'});await save();}
  } catch(error){failures.push({title:candidate.title,reason:error.message});await save();console.log(`  Search failed: ${error.message}`);}
}
await save();
console.log(`COMPLETE: ${ledger.length} real PDFs collected; ${failures.length} candidates skipped.`);
if(ledger.length<limit)process.exitCode=2;
