// Telemetry for swallowed exceptions.
//
// The codebase's `catch { return [] }` pattern keeps the UI resilient but
// makes every data-layer failure invisible — five platform-parse bugs
// shipped silently because of it, and on 2026-08-31 a user's drafted ESPN
// league failed to load with no error anywhere and no trace in Sentry.
//
// The previous version of this file only called addBreadcrumb(). Breadcrumbs
// attach to EVENTS: with no captureException anywhere in the app, they were
// collected and then discarded unless the session also happened to crash.
// That is why Sentry showed a healthy app while users saw empty screens.
// This version actually reports.
let Sentry: any = null;
try { Sentry = require('@sentry/react-native'); } catch { /* not installed in tests */ }

// A failing fetch inside a per-league Promise.all can fire the same tag a
// dozen times in a second. Report the first, suppress the rest for a while,
// and record how many were suppressed so volume stays visible.
const WINDOW_MS = 60_000;
const seen = new Map<string, { at: number; suppressed: number }>();

export function logCaught(tag: string, e: unknown, context?: Record<string, any>): void {
  const msg = (e as any)?.message ?? String(e);
  console.log(`[caught] ${tag}:`, msg, context ?? '');

  try {
    Sentry?.addBreadcrumb?.({
      category: 'caught',
      message: `${tag}: ${msg}`,
      level: 'warning',
      data: context,
    });

    const key = `${tag}|${msg}`;
    const now = Date.now();
    const prev = seen.get(key);
    if (prev && now - prev.at < WINDOW_MS) { prev.suppressed++; return; }
    const suppressed = prev?.suppressed ?? 0;
    seen.set(key, { at: now, suppressed: 0 });

    Sentry?.withScope?.((scope: any) => {
      scope.setLevel('warning');
      scope.setTag('caught_tag', tag);
      scope.setTag('caught_area', tag.split(':')[0] || 'unknown');
      if (context) scope.setContext('caught_context', context);
      if (suppressed > 0) scope.setExtra('suppressed_since_last', suppressed);
      if (e instanceof Error) Sentry.captureException(e);
      else Sentry.captureMessage(`${tag}: ${msg}`);
    });
  } catch { /* never let telemetry throw */ }
}

// Explicit marker for "no exception, but we returned nothing" — the failure
// mode that has no Error object to capture and is therefore the easiest to
// miss. e.g. discovery succeeded but the season filter matched zero leagues.
export function logEmpty(tag: string, context?: Record<string, any>): void {
  console.log(`[empty] ${tag}`, context ?? '');
  try {
    const key = `empty|${tag}`;
    const now = Date.now();
    const prev = seen.get(key);
    if (prev && now - prev.at < WINDOW_MS) { prev.suppressed++; return; }
    seen.set(key, { at: now, suppressed: 0 });
    Sentry?.withScope?.((scope: any) => {
      scope.setLevel('warning');
      scope.setTag('caught_tag', tag);
      scope.setTag('caught_area', tag.split(':')[0] || 'unknown');
      scope.setTag('empty_result', 'true');
      if (context) scope.setContext('caught_context', context);
      Sentry.captureMessage(`empty: ${tag}`);
    });
  } catch { /* never let telemetry throw */ }
}
