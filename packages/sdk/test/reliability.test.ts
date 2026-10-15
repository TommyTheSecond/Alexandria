import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import type { ClientConfig } from '../src/types.js';
const mocks = vi.hoisted(() => ({ readContract:vi.fn(), multicall:vi.fn(), writeContract:vi.fn(), waitForTransactionReceipt:vi.fn() }));
vi.mock('viem', async importOriginal => ({...await importOriginal<typeof import('viem')>(), createPublicClient:()=>mocks, createWalletClient:()=>mocks}));
const hash = `0x${'1'.repeat(64)}`;
const config:ClientConfig={rpcUrls:['https://rpc.example'],gateways:['https://gateway.example'],apiBase:'/api',contract:'0x1111111111111111111111111111111111111111',snapshotUrls:[],deployBlock:0};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('ethereum',{request:vi.fn(async({method})=>method==='eth_requestAccounts'?['0x2222222222222222222222222222222222222222']:null)});mocks.writeContract.mockResolvedValue(hash);});
afterEach(()=>{vi.unstubAllGlobals();});
describe.each(['review','flag'] as const)('%s receipt handling',action=>{
 it('rejects mined reverted transactions',async()=>{
  mocks.waitForTransactionReceipt.mockResolvedValue({status:'reverted',transactionHash:hash});
  const wallet=await createClient(config).connectWallet();
  await expect(action==='review'?wallet.review(1,true,'approve'):wallet.flag(1,'reason')).rejects.toMatchObject({code:'TX_REVERTED',detail:{status:'reverted'}});
 });
 it('returns successful transaction hash',async()=>{
  mocks.waitForTransactionReceipt.mockResolvedValue({status:'success',transactionHash:hash});
  const wallet=await createClient(config).connectWallet();
  await expect(action==='review'?wallet.review(1,true,'approve'):wallet.flag(1,'reason')).resolves.toBe(hash);
 });
});
it('starts pending metadata fetches together and preserves ID order',async()=>{
 mocks.readContract.mockResolvedValue(3n);
 mocks.multicall.mockResolvedValue([1,2,3].map(id=>({status:'success',result:{pdfCid:`pdf${id}`,metaCid:`meta${id}`,pdfSha256:hash,submitter:config.contract,submittedAt:1n,status:id===3?2:1,flags:0,confirmed:false}})));
 const releases:Array<()=>void>=[];
 const fetchMock=vi.fn((url:string)=>new Promise<Response>(resolve=>{releases.push(()=>resolve(new Response(JSON.stringify({title:url.endsWith('meta1')?'First':'Second'}))))}));
 vi.stubGlobal('fetch',fetchMock);
 const pending=createClient(config).getPending();
 try {await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2),{timeout:300});}
 finally {for(const release of releases.reverse())release();}
 const books=await pending;
 expect(books.map(book=>book.id)).toEqual([1,2]);
 expect(books.map(book=>book.meta?.title)).toEqual(['First','Second']);
});
it('times out a hanging snapshot and tries the next saved catalog',async()=>{
 const snapshot={network:'fuji',chainId:43113,contract:config.contract,atBlock:1,generatedAt:'2026-10-15T00:00:00Z',source:'snapshot',books:[]};
 vi.stubGlobal('fetch',vi.fn((url:string,opts?:RequestInit)=>url==='hang'?new Promise((_resolve,reject)=>opts?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))):Promise.resolve(new Response(JSON.stringify(snapshot)))));
 await expect(createClient({...config,rpcUrls:[],snapshotUrls:['hang','good']}).getCatalog({live:false})).resolves.toMatchObject({atBlock:1,source:'snapshot'});
},6500);
