'use client';
import { useEffect } from 'react';

export function useUnsavedWork(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const message = 'Some changes have not been saved to the server. Leave this page and lose those changes?';
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download') ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const next = new URL(link.href, location.href);
      if (next.pathname === location.pathname && next.search === location.search) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    // Capture before App Router processes a cancelled back/forward navigation.
    let current = { url: location.href, state: history.state };
    const pop = (event: PopStateEvent) => {
      if (!window.confirm(message)) {
        event.stopImmediatePropagation();
        history.pushState(current.state, '', current.url);
      } else {
        current = { url: location.href, state: history.state };
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', pop, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', pop, true);
    };
  }, [unsaved]);
}
