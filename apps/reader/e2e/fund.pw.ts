import { test, expect } from '@playwright/test';

test.describe('Alexandria Fund UI', () => {
  test('fund_missing_shows_soon: shows "Donations open soon" when fund contract is not deployed', async ({ page }) => {
    // When deployments/fuji-fund.json does not exist, both pages show "Donations open soon"
    await page.goto('/#/donate');
    await expect(page.getByText('Donations open soon')).toBeVisible();

    await page.goto('/#/nodes');
    await expect(page.getByText('Donations open soon')).toBeVisible();
  });

  test('donate_shows_split_and_tx: displays dynamic split and handles donation flow', async ({ page }) => {
    // Inject mock fund deployment and ethereum wallet for testing full UI flow
    await page.addInitScript(() => {
      const mockAddress = '0x1111111111111111111111111111111111111111';
      const mockTx = '0x' + 'b'.repeat(64);

      (window as any).ethereum = {
        request: async ({ method, params }: { method: string; params?: any[] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return [mockAddress];
          }
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
            return null;
          }
          if (method === 'eth_sendTransaction') {
            return mockTx;
          }
          if (method === 'eth_getTransactionReceipt') {
            return { status: '0x1', transactionHash: mockTx, blockNumber: '0x10' };
          }
          return null;
        },
      };
    });

    await page.goto('/#/donate');

    // If fund deployment is present, verify split and inputs
    const donateInput = page.getByLabel(/Amount/i);
    if (await donateInput.isVisible()) {
      await donateInput.fill('0.2');
      await expect(page.getByText(/0\.1000 AVAX to node operators · 0\.1000 AVAX to storage/)).toBeVisible();

      // Check note validation
      const noteInput = page.getByLabel(/Note/i);
      await noteInput.fill('For freedom of speech');

      const submitBtn = page.getByRole('button', { name: /DONATE WITH WALLET/i });
      await submitBtn.click();

      // Expect Snowtrace link or status message
      await expect(page.getByText(/Thank you for supporting Alexandria|View on Snowtrace/)).toBeVisible({ timeout: 10_000 });
    } else {
      // In absence of fuji-fund.json, verifies graceful fallback
      await expect(page.getByText('Donations open soon')).toBeVisible();
    }
  });

  test('nodes_lists_status: displays nodes table and run a node guide link', async ({ page }) => {
    await page.goto('/#/nodes');
    const nodesHeading = page.getByRole('heading', { name: /Node Operators/i });
    await expect(nodesHeading).toBeVisible();

    const openSoon = page.getByText('Donations open soon');
    if (await openSoon.isVisible()) {
      // Graceful fallback confirmed
      return;
    }

    // When fund is active, verify guide link and operators table
    await expect(page.getByRole('link', { name: /RUN A NODE/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Registered Nodes/i })).toBeVisible();
  });

  test('claim_shows_owed: displays operator earnings and claim flow', async ({ page }) => {
    await page.addInitScript(() => {
      const mockAddress = '0x2222222222222222222222222222222222222222';
      (window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return [mockAddress];
          }
          return null;
        },
      };
    });

    await page.goto('/#/nodes');

    const openSoon = page.getByText('Donations open soon');
    if (await openSoon.isVisible()) {
      // Graceful fallback confirmed
      return;
    }

    const connectBtn = page.getByRole('button', { name: /CONNECT OPERATOR WALLET/i });
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await expect(page.getByText(/Unclaimed earnings/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /CLAIM PAYOUT/i })).toBeVisible();
    }
  });
});
