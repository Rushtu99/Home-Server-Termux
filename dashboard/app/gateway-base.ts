type GatewayLocation = {
  host: string;
  hostname: string;
  origin: string;
  port: string;
  protocol: string;
};

export const resolveGatewayBase = (
  location: GatewayLocation,
  {
    basePath = '',
    backendOrigin = '',
    demoMode = false,
  }: { basePath?: string; backendOrigin?: string; demoMode?: boolean } = {}
) => {
  if (demoMode) {
    return `${location.origin}${basePath}`;
  }

  const normalizedBackendOrigin = String(backendOrigin || '').trim().replace(/\/+$/, '');
  if (normalizedBackendOrigin) {
    return normalizedBackendOrigin;
  }

  const normalizedPort = String(location.port || '').trim();
  if (normalizedPort === '3000') {
    return `${location.protocol}//${location.hostname}:4000`;
  }

  return `${location.protocol}//${location.host}`;
};
