// Minimal AWS Signature Version 4 signer for the Filebase S3 API (no SDK dependency).
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Returns the request headers to send: the given headers plus host, x-amz-date and authorization.
 * `body` is hashed for the signature unless headers['x-amz-content-sha256'] is already set.
 */
export function signRequest({ method, url, headers = {}, body = '', region, service, accessKeyId, secretAccessKey, date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);

  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((k) => `${k}:${all[k]}\n`).join('');
  const signedHeaders = names.join(';');

  const query = [...u.searchParams]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const payloadHash = all['x-amz-content-sha256'] ?? sha256(body);
  const canonicalRequest = [method, u.pathname || '/', query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const key = [day, region, service, 'aws4_request'].reduce(hmac, `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');

  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
