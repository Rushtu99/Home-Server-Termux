const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');

export const isDemoMode = () => DEMO_MODE;

export const getBasePath = () => BASE_PATH;

export const withBasePath = (inputPath = '/') => {
  const normalized = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
  return `${BASE_PATH}${normalized === '/' ? '' : normalized}` || '/';
};
