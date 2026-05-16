const buildAuthHandlers = ({
  appDb,
  verifyPassword,
  getLoginAttemptState,
  normalizeIp,
  pushDebugEvent,
  registerLoginFailure,
  LOGIN_MAX_ATTEMPTS,
  clearLoginFailures,
  invalidateSessionFromToken,
  readToken,
  createSession,
  issueToken,
  setAuthCookie,
  TOKEN_TTL,
  AUTH_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  buildPermissions,
  BOOTSTRAP_DASHBOARD_USER,
  clearAuthCookie,
}) => {
  const loginHandler = (req, res) => {
    const { username, password } = req.body || {};
    const existingAttempt = getLoginAttemptState(req);
    if (existingAttempt?.blockedUntilMs && existingAttempt.blockedUntilMs > Date.now()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existingAttempt.blockedUntilMs - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      pushDebugEvent('warn', 'Dashboard login rate limited', { ip: normalizeIp(req.ip || req.socket?.remoteAddress || '') }, true);
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    const authUser = appDb.findUserByUsername(username);
    const validPass = Boolean(
      authUser
      && !authUser.isDisabled
      && verifyPassword(password || '', authUser.passwordHash)
    );

    if (!validPass) {
      const usernameHint = (username || '(empty)').slice(0, 2);
      const attempt = registerLoginFailure(req);
      pushDebugEvent('warn', 'Dashboard login failed', { usernameHint: `${usernameHint}***` }, true);
      return res.status(401).json({
        error: 'Invalid credentials',
        attemptsRemaining: Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count),
      });
    }

    clearLoginFailures(req);
    invalidateSessionFromToken(readToken(req));

    const session = createSession(req, authUser);
    const token = issueToken(session);
    setAuthCookie(res, token, req);

    pushDebugEvent('info', 'Dashboard login success', { username: authUser.username, role: authUser.role }, true);
    return res.json({
      success: true,
      expiresIn: TOKEN_TTL,
      cookieName: AUTH_COOKIE_NAME,
      session: {
        idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
        absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
      },
      permissions: buildPermissions({ user: { role: authUser.role } }),
      user: { username: authUser.username, role: authUser.role },
    });
  };

  const meHandler = (req, res) => {
    return res.json({
      session: {
        idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
        absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
        createdAt: req.session ? new Date(req.session.createdAtMs).toISOString() : null,
        lastSeenAt: req.session ? new Date(req.session.lastSeenAtMs).toISOString() : null,
      },
      permissions: buildPermissions(req),
      user: {
        username: req.user?.sub || req.session?.username || BOOTSTRAP_DASHBOARD_USER,
        role: req.user?.role || req.session?.role || 'admin',
      },
    });
  };

  const verifyHandler = (req, res) => res.status(204).end();
  const verifyAdminHandler = (req, res) => res.status(204).end();

  const logoutHandler = (req, res) => {
    invalidateSessionFromToken(readToken(req));
    clearAuthCookie(res, req);
    pushDebugEvent('info', 'Dashboard logout', null, true);
    return res.json({ success: true });
  };

  return {
    loginHandler,
    meHandler,
    verifyHandler,
    verifyAdminHandler,
    logoutHandler,
  };
};

module.exports = {
  buildAuthHandlers,
};
