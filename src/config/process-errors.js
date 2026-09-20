export function createFatalErrorHandler({ shutdown, log = console.error }) {
  let handled = false;
  return async function handleFatalError(source, error) {
    if (handled) return false;
    handled = true;
    const safeCode = typeof error?.code === 'string'
      ? error.code
      : (error?.name || 'RUNTIME_FAILURE');
    log(`[FATAL] ${source}:${safeCode}`);
    return shutdown(source, { exitCode: 1 });
  };
}
