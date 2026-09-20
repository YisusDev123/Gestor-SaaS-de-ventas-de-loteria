export function success(res, data, { statusCode = 200, meta } = {}) {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
    correlationId: res.req.correlationId,
  });
}

export function paginated(res, items, { nextCursor = null, limit }) {
  return success(res, items, {
    meta: {
      pagination: {
        limit,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    },
  });
}
