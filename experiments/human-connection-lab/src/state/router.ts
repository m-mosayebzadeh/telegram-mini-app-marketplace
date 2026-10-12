/**
 * A hash router with four destinations and one depth.
 *
 * Halfway is a static app with no server, so the location lives in the hash.
 * Every route can be opened directly from a link, and every pushed screen has
 * an explicit parent, so "back" never depends on browser history existing.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'today' }
  | { name: 'conversations'; id?: string }
  | { name: 'you' }
  | { name: 'how' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'conversations':
      return { name: 'conversations', id: parts[1] };
    case 'you':
      return { name: 'you' };
    case 'how':
      return { name: 'how' };
    default:
      return { name: 'today' };
  }
}

export function hrefFor(route: Route): string {
  if (route.name === 'conversations') return route.id ? `#/conversations/${route.id}` : '#/conversations';
  return `#/${route.name}`;
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
