// Android lacks prebuilt native bcrypt binaries in this stack.
// Force runtime import "bcrypt" to resolve to pure-js "bcryptjs".
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'bcrypt') {
    return originalLoad.call(this, 'bcryptjs', parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
