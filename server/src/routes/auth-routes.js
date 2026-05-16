const registerAuthRoutes = ({ registerAuthRoute, handlers, middleware }) => {
  const {
    loginHandler,
    meHandler,
    verifyHandler,
    verifyAdminHandler,
    logoutHandler,
  } = handlers;
  const { requireAuth, requireAdmin } = middleware;

  registerAuthRoute('post', '/auth/login', loginHandler);
  registerAuthRoute('post', '/api/auth/login', loginHandler);
  registerAuthRoute('get', '/auth/me', requireAuth, meHandler);
  registerAuthRoute('get', '/api/auth/me', requireAuth, meHandler);
  registerAuthRoute('get', '/auth/verify', requireAuth, verifyHandler);
  registerAuthRoute('get', '/api/auth/verify', requireAuth, verifyHandler);
  registerAuthRoute('get', '/auth/verify-admin', requireAuth, requireAdmin, verifyAdminHandler);
  registerAuthRoute('get', '/api/auth/verify-admin', requireAuth, requireAdmin, verifyAdminHandler);
  registerAuthRoute('post', '/auth/logout', logoutHandler);
  registerAuthRoute('post', '/api/auth/logout', logoutHandler);
};

module.exports = {
  registerAuthRoutes,
};
