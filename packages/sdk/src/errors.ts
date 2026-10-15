import type { SdkError, SdkErrorCode } from './types.js';

export class AlexandriaError extends Error implements SdkError {
  code: SdkErrorCode;
  detail?: unknown;

  constructor(code: SdkErrorCode, message?: string, detail?: unknown) {
    super(message ?? code);
    this.name = 'AlexandriaError';
    this.code = code;
    this.detail = detail;
  }
}
