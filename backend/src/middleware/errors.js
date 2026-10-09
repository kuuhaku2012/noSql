import { HttpError } from "../lib/errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Resource not found" },
    requestId: req.requestId
  });
}

export function errorHandler(error, req, res, _next) {
  const normalized = error instanceof HttpError
    ? error
    : error?.code === 11000
      ? new HttpError(409, "DUPLICATE_RESOURCE", "A unique value is already in use")
      : error?.type === "entity.parse.failed"
        ? new HttpError(400, "INVALID_JSON", "Request body must be valid JSON")
        : new HttpError(500, "INTERNAL_ERROR", "An unexpected server error occurred");
  if (normalized.status >= 500) console.error(error);
  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details?.length ? { details: normalized.details } : {})
    },
    requestId: req.requestId
  });
}
