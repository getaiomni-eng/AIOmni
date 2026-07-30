// Breadcrumb for swallowed exceptions. The codebase's `catch { return [] }`
// pattern kept the UI resilient but made every data-layer failure
// invisible — five platform-parse bugs shipped silently because of it.
// This keeps the resilience and surfaces the failure to Sentry + console.
let Sentry: any = null;
try { Sentry = require('@sentry/react-native'); } catch { /* not installed in tests */ }

export function logCaught(tag: string, e: unknown): void {
  const msg = (e as any)?.message ?? String(e);
  console.log(`[caught] ${tag}:`, msg);
  try {
    Sentry?.addBreadcrumb?.({ category: 'caught', message: `${tag}: ${msg}`, level: 'warning' });
  } catch { /* never let telemetry throw */ }
}
