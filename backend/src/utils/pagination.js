function getPagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPageMeta({ page, limit, count }) {
  return {
    page,
    limit,
    totalItems: count,
    totalPages: Math.ceil(count / limit) || 1,
  };
}

module.exports = { getPagination, buildPageMeta };
