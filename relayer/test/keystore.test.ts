import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptKeystoreJson } from 'ethers';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, expect, it, vi } from 'vitest';
import { unlockKeystore } from '../src/keystore.js';

const directories: string[] = [];
const castAvailable = spawnSync('cast', ['--version'], { stdio: 'ignore' }).status === 0;
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'alexandria-keystore-test-'));
  directories.push(directory);
  const privateKey = generatePrivateKey();
  const expectedRelayer = privateKeyToAccount(privateKey).address;
  const password = randomBytes(24).toString('hex');
  // Low scrypt cost is restricted to ephemeral test wallets, never production wallets.
  const json = await encryptKeystoreJson({ address: expectedRelayer, privateKey }, password,
    { scrypt: { N: 1024, r: 8, p: 1 } });
  const parsed = JSON.parse(json) as Record<string, unknown>;
  delete parsed.address; // Foundry's JSON keystores may omit public address metadata.
  const keystorePath = join(directory, 'relayer');
  writeFileSync(keystorePath, JSON.stringify(parsed), { mode: 0o600 });
  const passwordFile = join(directory, 'unlock');
  writeFileSync(passwordFile, password + '\r\n', { mode: 0o600 });
  return { privateKey, password, keystorePath, passwordFile, expectedRelayer };
}

it('unlocks_a_foundry_format_keystore_with_a_local_password_file', async () => {
  const f = await fixture();
  const prompt = vi.fn();
  expect(await unlockKeystore(f, prompt)).toBe(f.privateKey);
  expect(prompt).not.toHaveBeenCalled();
});

it('uses_a_hidden_terminal_password_provider_when_no_password_file_is_set', async () => {
  const f = await fixture();
  const prompt = vi.fn(async () => f.password);
  expect(await unlockKeystore({ ...f, passwordFile: undefined }, prompt)).toBe(f.privateKey);
  expect(prompt).toHaveBeenCalledOnce();
});

it('rejects_the_wrong_password_without_echoing_any_secret_or_key_material', async () => {
  const f = await fixture();
  const wrong = randomBytes(24).toString('hex');
  writeFileSync(f.passwordFile, wrong);
  let message = '';
  try { await unlockKeystore(f); } catch (error) { message = (error as Error).message; }
  expect(message).toBe('Cannot unlock relayer keystore: check the password and encrypted JSON file');
  expect([wrong, f.password, f.privateKey].some(secret => message.includes(secret))).toBe(false);
});

it('rejects_a_deployer_or_other_wallet_that_does_not_match_the_deployment_relayer', async () => {
  const f = await fixture();
  const other = privateKeyToAccount(generatePrivateKey()).address;
  await expect(unlockKeystore({ ...f, expectedRelayer: other })).rejects.toThrow('does not match DEPLOYMENT relayer');
});

it('preserves_spaces_in_the_password_and_strips_only_one_file_line_ending', async () => {
  const f = await fixture();
  writeFileSync(f.passwordFile, ' ' + f.password + ' \n');
  await expect(unlockKeystore(f)).rejects.toThrow('Cannot unlock relayer keystore');
});

it('reports_missing_files_and_headless_unlock_requirements_without_dumping_config', async () => {
  const f = await fixture();
  await expect(unlockKeystore({ ...f, keystorePath: join(f.keystorePath, 'missing') })).rejects.toThrow('Cannot read RELAYER_KEYSTORE');
  await expect(unlockKeystore({ ...f, passwordFile: join(f.passwordFile, 'missing') })).rejects.toThrow('Cannot read RELAYER_PASSWORD_FILE');
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    await expect(unlockKeystore({ ...f, passwordFile: undefined })).rejects.toThrow('RELAYER_PASSWORD_FILE');
  }
});

it.skipIf(process.platform === 'win32')('rejects_a_password_file_readable_by_other_users', async () => {
  const f = await fixture();
  chmodSync(f.passwordFile, 0o644);
  await expect(unlockKeystore(f)).rejects.toThrow('owner-only permissions');
});

it.skipIf(!castAvailable)('unlocks_an_actual_foundry_generated_keystore_without_exporting_its_key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alexandria-foundry-keystore-test-'));
  directories.push(directory);
  const password = ' ' + randomBytes(24).toString('hex') + 'e\u0301 ';
  // The test-only password is passed in memory to the child environment, never argv or logs.
  const generated = spawnSync('cast', ['wallet', 'new', directory, 'ephemeral-relayer'], {
    env: { ...process.env, CAST_PASSWORD: password }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
  });
  expect(generated.status).toBe(0);
  const address = (generated.stdout + generated.stderr).match(/0x[0-9a-fA-F]{40}\b/)?.[0];
  expect(Boolean(address)).toBe(true);
  const privateKey = await unlockKeystore({ keystorePath: join(directory, 'ephemeral-relayer'),
    expectedRelayer: address as `0x${string}` }, async () => password);
  expect(privateKeyToAccount(privateKey).address.toLowerCase() === address?.toLowerCase()).toBe(true);
});
