import { ObjectId } from "mongodb";
import { validationError } from "./errors.js";

export function validateBody(schema, body = {}) {
  const details = [];
  for (const [field, rule] of Object.entries(schema)) {
    const value = body[field];
    if (value === undefined || value === null || value === "") {
      if (rule.required) details.push({ field, message: "Field is required" });
      continue;
    }
    if (rule.type === "positiveInteger" && (!Number.isInteger(value) || value <= 0)) {
      details.push({ field, message: "Must be a positive integer" });
    } else if (rule.type === "nonNegativeNumber" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      details.push({ field, message: "Must be a non-negative number" });
    } else if (rule.type === "string" && typeof value !== "string") {
      details.push({ field, message: "Must be a string" });
    } else if (rule.type === "objectId" && !ObjectId.isValid(value)) {
      details.push({ field, message: "Must be a valid ObjectId" });
    }
    if (rule.maxLength && typeof value === "string" && value.length > rule.maxLength) {
      details.push({ field, message: `Must be at most ${rule.maxLength} characters` });
    }
  }
  if (details.length) throw validationError(undefined, details);
  return body;
}

export function assertObjectId(value, field = "id") {
  if (!ObjectId.isValid(value)) {
    throw validationError(undefined, [{ field, message: "Must be a valid ObjectId" }]);
  }
  return new ObjectId(value);
}

export function optionalObjectId(value, field) {
  return value === undefined || value === null || value === "" ? null : assertObjectId(value, field);
}

export function toReference(value, field = "id") {
  if (value === undefined || value === null || value === "") {
    throw validationError(undefined, [{ field, message: "Field is required" }]);
  }
  return ObjectId.isValid(value) ? new ObjectId(value) : String(value);
}
