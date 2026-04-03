export const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error || fallback;
  }
  if (error === null || typeof error === 'undefined') {
    return fallback;
  }
  return String(error) || fallback;
};
