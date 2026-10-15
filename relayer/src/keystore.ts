import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Wallet } from 'ethers';
import { getAddress, type Address, type Hex } from 'viem';

export interface KeystoreConfig {
  keystorePath: string;
  passwordFile?: string;
  expectedRelayer: Address;
}
export class WalletUnlockError extends Error {}

async function terminalPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new WalletUnlockError('Headless startup requires RELAYER_PASSWORD_FILE pointing to a local service credential');
  }
  // Suppress readline echo, including pasted text. Never use a password command argument.
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  const controller = new AbortController();
  reader.once('SIGINT', () => controller.abort());
  process.stderr.write('Relayer keystore password (hidden): ');
  try { return await reader.question('', { signal: controller.signal }); }
  catch { throw new WalletUnlockError('Relayer keystore unlock cancelled'); }
  finally { reader.close(); muted.destroy(); process.stderr.write('\n'); }
}

async function passwordFromFile(path: string): Promise<string> {
  try {
    const info = await stat(path);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new WalletUnlockError('RELAYER_PASSWORD_FILE requires owner-only permissions (0600 or 0400)');
    }
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid password file');
    // Preserve spaces in the actual password; accept the newline written by service credential tools.
    return (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  } catch (error) {
    if (error instanceof WalletUnlockError) throw error;
    throw new WalletUnlockError('Cannot read RELAYER_PASSWORD_FILE');
  }
}

/** Decrypt at startup only; the plaintext key never goes into .env, a log, or a child command. */
export async function unlockKeystore(config: KeystoreConfig, prompt = terminalPassword): Promise<Hex> {
  let json: string;
  try {
    const info = await stat(config.keystorePath);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid keystore file');
    json = await readFile(config.keystorePath, 'utf8');
  } catch { throw new WalletUnlockError('Cannot read RELAYER_KEYSTORE encrypted JSON file'); }
  let password: string | undefined = config.passwordFile
    ? await passwordFromFile(config.passwordFile) : await prompt();
  const passwordBytes = Buffer.from(password, 'utf8');
  try {
    if (password.length === 0) throw new WalletUnlockError('Relayer keystore password must not be empty');
    // Foundry uses exact UTF-8 bytes; avoid the Unicode normalization applied to string passwords.
    const wallet = await Wallet.fromEncryptedJson(json, passwordBytes);
    if (getAddress(wallet.address) !== getAddress(config.expectedRelayer)) {
      throw new WalletUnlockError('Unlocked account does not match DEPLOYMENT relayer; use the relayer keystore, not the deployer');
    }
    return wallet.privateKey as Hex;
  } catch (error) {
    if (error instanceof WalletUnlockError) throw error;
    // Library errors can contain decrypted bytes, input or password details. Do not propagate them.
    throw new WalletUnlockError('Cannot unlock relayer keystore: check the password and encrypted JSON file');
  } finally { passwordBytes.fill(0); password = undefined; }
}
