type GatewayLocation = {
  host: string;
  hostname: string;
  origin: string;
  port: string;
  protocol: string;
};

export const resolveGatewayBase = (
  location: GatewayLocation,
  { basePath = '', demoMode = false }: { basePath?: string; demoMode?: boolean } = {}
) => {
  if (demoMode) {
    return `${location.origin}${basePath}`;
  }

  const normalizedPort = String(location.port || '').trim();
  if (normalizedPort === '3000') {
    return `${location.protocol}//${location.hostname}:8088`;
  }

  return `${location.protocol}//${location.host}`;
};
