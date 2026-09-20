export class AppError extends Error {
  constructor(message, { statusCode = 400, code = 'OPERATION_FAILED', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}
