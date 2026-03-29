const LOCAL_API_ORIGIN = process.env.LOCAL_API_ORIGIN || 'http://127.0.0.1:4000';
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || '127.0.0.1,localhost')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: false,
  allowedDevOrigins,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${LOCAL_API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
