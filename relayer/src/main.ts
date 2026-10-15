import { ChainStartupError, createChainGateway } from './chain.js';
import { loadConfig } from './env.js';
import { createRelayerServer, listenLoopback } from './server.js';
import { unlockKeystore, WalletUnlockError } from './keystore.js';

try {
  const config = loadConfig();
  const gateway = await createChainGateway({ ...config, privateKey: await unlockKeystore(config) });
  if (await gateway.getBalance() < 500_000_000_000_000_000n) console.warn('Relayer test AVAX balance is below 0.5 AVAX');
  const server = createRelayerServer({ secret: config.secret, gateway, dailyLimit: config.dailyCap,
    onSubmitted: ({ bookId, txHash }) => console.log(JSON.stringify({ bookId, txHash })) });
  await listenLoopback(server, config.port);
  const balanceTimer = setInterval(() => {
    void gateway.getBalance().then(balance => {
      if (balance < 500_000_000_000_000_000n) console.warn('Relayer test AVAX balance is below 0.5 AVAX');
    }).catch(() => console.warn('Unable to check relayer test AVAX balance'));
  }, 60_000);
  balanceTimer.unref();
  const shutdown = () => { clearInterval(balanceTimer); server.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  // Never print the underlying RPC error, request, environment or signing material.
  console.error(error instanceof ChainStartupError || error instanceof WalletUnlockError ? error.message
    : 'Relayer startup failed: check encrypted keystore configuration, deployment, RPC chain ID and balance.');
  process.exitCode = 1;
}
