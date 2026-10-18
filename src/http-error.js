'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Throws a 409 when a rule check returned a reason the action is not allowed.
function assertAllowed(reason) {
  if (reason) throw new HttpError(409, reason);
}

module.exports = { HttpError, assertAllowed };
