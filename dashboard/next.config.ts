import { execSync } from 'node:child_process';

const LOCAL_API_ORIGIN = process.env.LOCAL_API_ORIGIN || 'http://127.0.0.1:4000';
const isDemoBuild = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.DEMO_EXPORT === 'true';
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || '127.0.0.1,localhost')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const buildTimestamp = new Date().toISOString();

const readGitMeta = () => {
  try {
    return {
      commitFull: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
      commitShort: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
      commitDate: execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim(),
    };
  } catch {
    return {
      commitFull: 'unknown',
      commitShort: 'unknown',
      commitDate: '',
    };
  }
};

const gitMeta = readGitMeta();

const nextConfig = {
  reactStrictMode: false,
  allowedDevOrigins,
  assetPrefix: basePath || undefined,
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTimestamp,
    NEXT_PUBLIC_LAST_COMMIT_DATE: gitMeta.commitDate,
    NEXT_PUBLIC_LAST_COMMIT_ID: gitMeta.commitShort,
    NEXT_PUBLIC_LAST_COMMIT_FULL: gitMeta.commitFull,
  },
  experimental: {
    webpackBuildWorker: false,
  },
  images: {
    unoptimized: isDemoBuild,
  },
  output: isDemoBuild ? 'export' : undefined,
  trailingSlash: isDemoBuild,
  ...(!isDemoBuild
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${LOCAL_API_ORIGIN}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
