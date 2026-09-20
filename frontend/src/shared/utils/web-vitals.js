export async function observeWebVitals(report = (metric) => {
  window.dispatchEvent(new CustomEvent('gestion:web-vital', { detail: metric }));
}) {
  const { onCLS, onINP, onLCP } = await import('web-vitals');
  onCLS(report);
  onINP(report);
  onLCP(report);
}
