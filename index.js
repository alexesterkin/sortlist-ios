// Entry point. Wire global error/rejection hooks BEFORE expo-router loads so
// anything that explodes during the initial module evaluation lands in the
// device logs (Xcode Console / `xcrun simctl spawn booted log stream`)
// instead of dying silently with the splash screen still up.
//
// React's ErrorBoundary (in app/_layout.tsx) catches render-phase errors,
// but native + bootstrap errors happen before any React tree exists. These
// global hooks fill that gap.
if (typeof globalThis !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[Sortlist] boot: index.js evaluating');

  if (globalThis.ErrorUtils) {
    const prev = globalThis.ErrorUtils.getGlobalHandler?.();
    globalThis.ErrorUtils.setGlobalHandler((err, isFatal) => {
      // eslint-disable-next-line no-console
      console.error(
        `[Sortlist] global ${isFatal ? 'FATAL' : 'non-fatal'} error:`,
        err && err.stack ? err.stack : err,
      );
      if (prev) prev(err, isFatal);
    });
  }

  if (typeof process !== 'undefined' && process && process.on) {
    process.on('unhandledRejection', (reason) => {
      // eslint-disable-next-line no-console
      console.error('[Sortlist] unhandledRejection:', reason);
    });
  }
}

import 'expo-router/entry';
