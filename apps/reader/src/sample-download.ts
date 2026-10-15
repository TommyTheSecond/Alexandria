// Local sample-mode helper only. Production downloads belong to @alexandria/sdk.
export async function verifiedSample(bytes: ArrayBuffer, expected: string) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = '0x' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error('The sample copy is damaged. Nothing was saved.');
  return new Blob([bytes], { type: 'application/pdf' });
}
