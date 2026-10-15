import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rpcs = JSON.parse(readFileSync(resolve(ROOT, 'infra/rpcs.json'), 'utf8'));
const artifact = JSON.parse(readFileSync(resolve(ROOT, 'contracts/out/Alexandria.sol/Alexandria.json'), 'utf8'));

// The dedicated local curator/admin keypair
const PK = process.env.CURATOR_KEY;
if (!PK) {
  throw new Error('CURATOR_KEY environment variable is required (must be a hex private key)');
}
const account = privateKeyToAccount(PK);
const rpcUrl = process.env.RPC_URL || rpcs.clearnet[0];

console.log('====================================================');
console.log('ALEXANDRIA FUJI AUTOMATED SETUP');
console.log('Account Address:  ', account.address);
console.log('Target Network:   Avalanche Fuji (43113)');
console.log('RPC URL:          ', rpcUrl);
console.log('====================================================\n');

const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: avalancheFuji,
  transport: http(rpcUrl),
});

const BATCH_2_BOOKS = [
  {
    title: 'Il Decameron',
    pdfCid: 'bafybeidzceqhcn5mxjys34i6qflr6eiwvmhbwnynsb7dw4j7piifihz6ba',
    metaCid: 'bafkreidq7ixzgywhhy6pgbdw2uiq727wvpnmedvv2mnixy4etomjqtl754',
    pdfSha256: '0xc954049271357c15182f6a7c9d26fcef072fdf4e1687f257c9f8d8f46be182d0',
  },
  {
    title: 'Lysistrata',
    pdfCid: 'bafybeig3ujg3kof4imkfqflwwj6qfbm6fpqxhkr6izltm2nhac7qnyvnp4',
    metaCid: 'bafkreia2nz63shwtcbisots5rkl2eh2rm62vazwnhtek6uua4hjcnufhzy',
    pdfSha256: '0xaa3720a37bc4c1fcbb0dec6fa4dc994d1c47e09fa1bc7b6830dcaedd315ae12a',
  },
  {
    title: 'My Life and Loves, vol. 1',
    pdfCid: 'bafybeid66lk3pz4334vnzkutoz4obvfq7hrpxmv4jasvyf75dbh4g6hege',
    metaCid: 'bafkreichugwahtczsrecdfjbpetmiah6sgz3xjf75wgnduz7fflv5s3dqi',
    pdfSha256: '0xf9fb493d8f8816764c00d01f68953c67e7994841c40fa62afc7b29343a0e930e',
  },
  {
    title: 'La Terre',
    pdfCid: 'bafybeieeymjx7sj2i4xl63tra43f7j5tzkblykm2cnqxeaa72d4rv2ozky',
    metaCid: 'bafkreicmyfidc2clin2swbgai3rfgqgf25y6wlsliaah7gtewg43yb66wm',
    pdfSha256: '0x53b3b9db213621f27d6e49cf08713c9cdd6d6ee2f8a62fb8639956603188ace2',
  },
  {
    title: 'Pamela',
    pdfCid: 'bafybeiglkykbsgujk2xn2geoiwh7rzf4jyj4k6flfpdfnjytlqws3xtfya',
    metaCid: 'bafkreiec554lm5epziazsd2bupuv2qcgx2q5hbo73qf3ms7orrcqn7om3e',
    pdfSha256: '0xadaaf29a523ce1e633f82ae619ef9fd5417f4908c197e3902c1967b72f4e274f',
  },
  {
    title: 'The Rainbow',
    pdfCid: 'bafybeiblukfemqeettnijyeeouhhiabkqt4u5szmrt4s6ugrlebd74jx6u',
    metaCid: 'bafkreigfkt5lbu2bxwc4huptlhyup3qgyzv653di4eo4t247elehyqmxry',
    pdfSha256: '0x0e142eb9c89275eee744654388156631517ae7885f63208effa1c5e48bedab17',
  },
  {
    title: 'Trionfo della Morte',
    pdfCid: 'bafybeidhvsqkjwtnw6ekcs3w7jvpc7eqhvvientjldszgq2fng22z6eiqu',
    metaCid: 'bafkreihnb7wnpwljqjfxwfkyyeg2jmnxsryhr5biomvrdj3v7j3fbisnum',
    pdfSha256: '0xa82c3848d2eb74d248dfd9ca8021f256f902134666a126df0c708615c64a4b57',
  },
  {
    title: 'The Well of Loneliness',
    pdfCid: 'bafybeic5zz557atyurvfmjb5qgnn5xlj2ld3gq6dozrdboaojqcyoiixbi',
    metaCid: 'bafkreif6224zdtpcicyh5djosx26ddki2uxmhgduowi7dywnpdxewyhzza',
    pdfSha256: '0x1779ef474d6dc13715bd4d487543f3fd406ed7191b51d909e20d3bebd8703d4b',
  },
  {
    title: 'Lady Chatterley\'s Lover',
    pdfCid: 'bafybeibhocfiybnnm5webvsjbeus36wv5sozk2ulv32mdbgqqgwl4as6xa',
    metaCid: 'bafkreigbobpqzwxlxvjaevuruvi4gtkdtwilp3bllkadjagnmjd7pj336q',
    pdfSha256: '0x48070209b0677e96894a33c88951a3f811e6a77f6e264a3a3edd6ce65ededaa4',
  },
  {
    title: 'Madame Bovary',
    pdfCid: 'bafybeihs2rkr2fukui3x27mupdrnaxleoqu7ayh626je5natbk6kuc7c5i',
    metaCid: 'bafkreidmdk7wcfbjruajehms7mfc3u33vmq6p5j6onecbvbhfb4dvitnce',
    pdfSha256: '0x21843a05879a665072eb1a7a9087837087e70c7f88d3a49c68bc61adced69a7b',
  },
];

async function main() {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Current Balance: ${formatEther(balance)} AVAX`);

  if (balance < parseEther('0.05')) {
    console.error('\n[WAITING] Insufficient test AVAX on address:', account.address);
    console.error('Please send ~0.2 test AVAX to this address or use the faucet:');
    console.error('https://core.app/tools/testnet-faucet/?subnet=c&token=c\n');
    process.exit(1);
  }

  console.log('\nStep 1: Deploying fresh Alexandria.sol to Fuji...');
  const deployTxHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [
      account.address,            // admin
      [account.address],          // curators
      account.address,            // relayer
    ],
  });

  console.log(`Deploy tx broadcast: ${deployTxHash}`);
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
  const contractAddress = deployReceipt.contractAddress;
  console.log(`Contract deployed at: ${contractAddress} (block ${deployReceipt.blockNumber})`);

  console.log('\nStep 2: Submitting 10 Batch 2 Books...');
  const bookIds = [];
  for (let i = 0; i < BATCH_2_BOOKS.length; i++) {
    const book = BATCH_2_BOOKS[i];
    console.log(`  Submitting Book #${i + 1}: ${book.title}...`);
    const tx = await walletClient.writeContract({
      address: contractAddress,
      abi: artifact.abi,
      functionName: 'submitBook',
      args: [book.pdfCid, book.metaCid, book.pdfSha256],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    bookIds.push(i + 1);
  }

  console.log('\nStep 3: Curator Approving all 10 Books...');
  for (const id of bookIds) {
    console.log(`  Approving Book #${id}...`);
    const tx = await walletClient.writeContract({
      address: contractAddress,
      abi: artifact.abi,
      functionName: 'review',
      args: [BigInt(id), true, 'Public domain verified Batch 2'],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  console.log('\nStep 4: Updating deployments/fuji.json...');
  const deploymentRecord = {
    abi: 'abi/IAlexandria.json',
    address: contractAddress,
    admin: account.address,
    chainId: 43113,
    curators: [account.address],
    deployBlock: Number(deployReceipt.blockNumber),
    deployTx: deployTxHash,
    explorer: `https://testnet.snowtrace.io/address/${contractAddress}`,
    network: 'fuji',
    relayer: account.address,
  };
  writeFileSync(resolve(ROOT, 'deployments/fuji.json'), JSON.stringify(deploymentRecord, null, 2) + '\n');
  console.log('Updated deployments/fuji.json');

  console.log('\nStep 5: Verifying On-Chain Status...');
  const bookCount = await publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: 'bookCount',
  });
  console.log(`Live Fuji bookCount: ${bookCount}`);

  console.log('\nALL DONE! All 10 books are now Approved on Avalanche Fuji!');
}

main().catch(err => {
  console.error('Error during setup:', err);
  process.exit(1);
});
