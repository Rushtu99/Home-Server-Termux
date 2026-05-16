const createDualRouteRegistrar = ({ registerDualRoute }) =>
  (method, routePath, ...handlers) => registerDualRoute(method, routePath, ...handlers);

module.exports = {
  createDualRouteRegistrar,
};
