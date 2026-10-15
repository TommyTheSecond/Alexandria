import { describe, expect, it } from 'vitest';
import { encodeErrorResult, parseAbi } from 'viem';
import { ContractFunctionRevertedError } from 'viem';
import { decodeChainFailure } from '../src/chain.js';

const abi = parseAbi(['error Duplicate(uint256 existingId)', 'error SubmissionsClosed()']);

describe('decoded contract failures', () => {
  it('preserves the existing ID from a raced Duplicate revert', () => {
    const data = encodeErrorResult({ abi, errorName: 'Duplicate', args: [7n] });
    const reverted = new ContractFunctionRevertedError({ abi, data, functionName: 'submitBook' });
    const wrapped = new Error('RPC request failed', { cause: reverted });
    expect(decodeChainFailure(wrapped)).toMatchObject({ detail: 'Duplicate', duplicateId: 7 });
  });

  it('keeps other decoded error names without exposing RPC text', () => {
    const data = encodeErrorResult({ abi, errorName: 'SubmissionsClosed' });
    const reverted = new ContractFunctionRevertedError({ abi, data, functionName: 'submitBook' });
    expect(decodeChainFailure(reverted)).toMatchObject({ detail: 'SubmissionsClosed' });
  });
});
