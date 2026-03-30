const LOCAL_API_ORIGIN = process.env.LOCAL_API_ORIGIN || 'http://127.0.0.1:4000';
const isDemoBuild = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.DEMO_EXPORT === 'true';
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || '127.0.0.1,localhost')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: false,
  allowedDevOrigins,
  assetPrefix: basePath || undefined,
  basePath: basePath || undefined,
  experimental: {
    webpackBuildWorker: false,
  },
  images: {
    unoptimized: isDemoBuild,
  },
  output: isDemoBuild ? 'export' : undefined,
  trailingSlash: isDemoBuild,
  async rewrites() {
    if (isDemoBuild) {
      return [];
    }
    return [
      {
        source: '/api/:path*',
        destination: `${LOCAL_API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
