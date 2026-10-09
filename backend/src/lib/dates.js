export function inclusiveEndDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return date;
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const storedAtMidnight = value instanceof Date && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (dateOnly || storedAtMidnight) date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function isDateRangeActive(startValue, endValue, now = new Date()) {
  const start = new Date(startValue);
  const end = inclusiveEndDate(endValue);
  const current = new Date(now);
  return !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && current >= start && current <= end;
}
