export function parsePagination(query = {}) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page || "1", 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit || "20", 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
