export class RequestError extends Error {
  status: number;

  code: string;

  retryable: boolean;

  constructor(status: number, code: string, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
