const LOCAL_API_ORIGIN = process.env.LOCAL_API_ORIGIN || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: false,
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
