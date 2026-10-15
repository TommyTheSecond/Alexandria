import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest } from './sigv4.mjs';

const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

// AWS Signature Version 4 test suite, "get-vanilla".
test('matches the AWS SigV4 get-vanilla test vector', () => {
  const h = signRequest({
    method: 'GET',
    url: 'https://example.amazonaws.com/',
    region: 'us-east-1',
    service: 'service',
    date: new Date('2015-08-30T12:36:00Z'),
    ...creds,
  });
  assert.equal(h['x-amz-date'], '20150830T123600Z');
  assert.equal(
    h.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

test('extra headers are signed and query parameters are sorted', () => {
  const h = signRequest({
    method: 'GET',
    url: 'https://s3.filebase.com/bucket?list-type=2&continuation-token=a%2Fb',
    headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    region: 'us-east-1',
    service: 's3',
    date: new Date('2015-08-30T12:36:00Z'),
    ...creds,
  });
  assert.match(h.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/);
  assert.equal(h['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD');
});
