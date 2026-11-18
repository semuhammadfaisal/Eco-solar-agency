/**
 * Operational error with an HTTP status code.
 * Anything thrown that is not an ApiError is treated as an unexpected 500.
 */
'use strict';

class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Safe, user-facing message
   * @param {object} [details] Optional validation details (never sent raw in production)
   */
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'You must sign in to continue.') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError(403, message);
  }

  static notFound(message = 'The requested record was not found.') {
    return new ApiError(404, message);
  }

  static conflict(message, details) {
    return new ApiError(409, message, details);
  }
}

module.exports = ApiError;
