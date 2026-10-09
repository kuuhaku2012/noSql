export class HttpError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message = "Request data is invalid", details = []) {
  return new HttpError(400, "VALIDATION_ERROR", message, details);
}

export function notFound(message = "Resource not found") {
  return new HttpError(404, "NOT_FOUND", message);
}

export function forbidden(message = "You do not have permission for this action") {
  return new HttpError(403, "FORBIDDEN", message);
}
