/**
 * The frame: navigation, the current screen, notices.
 *
 * On a phone a conversation is a pushed screen (the bottom bar steps aside so
 * the writing space has room); from 1080px the list and the conversation sit
 * side by side, so the same address shows both.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Nav } from './ui/Nav';
import { Notices } from './ui/Notices';
import { Seal } from './ui/Seal';
import { useWorld } from './state/WorldContext';
import { hrefFor, useRoute, type Route } from './state/router';
import { Today } from './screens/Today';
import { ConversationList } from './screens/Conversations';
import { ConversationView } from './screens/ConversationView';
import { You } from './screens/You';
import { How } from './screens/How';
import { needsMe, visibleConversations } from './domain/world';

export const WIDE_QUERY = '(min-width: 1080px)';

function useMediaQuery(query: string): boolean {
  const get = () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const TITLES: Record<Route['name'], string> = {
  today: 'Today',
  conversations: 'Conversations',
  you: 'You',
  how: 'How it works',
};

/** Going back to a screen returns you to where you were on it. */
function useScrollMemory(route: Route) {
  const positions = useRef(new Map<string, number>());
  const key = hrefFor(route);
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    positions.current.set(previous.current, window.scrollY);
    previous.current = key;
    window.scrollTo?.(0, positions.current.get(key) ?? 0);
  }, [key]);
}

export function App() {
  const route = useRoute();
  const { world, storage } = useWorld();
  const wide = useMediaQuery(WIDE_QUERY);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useScrollMemory(route);

  const waiting = visibleConversations(world).filter((c) => c.status === 'active' && needsMe(c)).length;
  const conversationId = route.name === 'conversations' ? route.id : undefined;
  const pushed = Boolean(conversationId) && !wide;

  useEffect(() => {
    document.title = `${TITLES[route.name]} · Halfway`;
  }, [route.name]);

  let screen;
  switch (route.name) {
    case 'today':
      screen = <Today />;
      break;
    case 'you':
      screen = <You />;
      break;
    case 'how':
      screen = <How />;
      break;
    case 'conversations':
      if (wide) {
        screen = (
          <div className="two-pane">
            <div className="two-pane__list">
              <ConversationList activeId={conversationId} />
            </div>
            <div className="two-pane__detail">
              {conversationId ? (
                <ConversationView key={conversationId} id={conversationId} pushed={false} />
              ) : (
                <div className="pane-empty">
                  <Seal state="open" size={56} decorative />
                  <p>Choose a conversation to read it here.</p>
                </div>
              )}
            </div>
          </div>
        );
      } else {
        screen = conversationId ? <ConversationView key={conversationId} id={conversationId} pushed /> : <ConversationList />;
      }
      break;
  }

  const banner =
    storage === 'unavailable' || storage === 'failing'
      ? 'This browser isn’t letting Halfway save. Everything works, but this world will be forgotten when the tab closes.'
      : storage === 'recovered'
        ? 'Your saved world couldn’t be read, so a fresh one has begun.'
        : storage === 'upgraded'
          ? 'Halfway has changed since your last visit — conversations now have replies and doors — so a fresh world has begun.'
          : null;

  return (
    <div className={`app ${pushed ? 'app--pushed' : ''} ${route.name === 'conversations' && wide ? 'app--wide-convo' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav route={route} waiting={waiting} />
      <div className="frame">
        {!pushed && (
          <header className="topbar">
            <a className="wordmark" href={hrefFor({ name: 'today' })}>
              <Seal state="whole" size={16} decorative className="wordmark__seal" />
              Halfway
            </a>
            <a className="demo-tag" href={hrefFor({ name: 'how' })}>
              Demo world
            </a>
          </header>
        )}
        <main id="main" className="main" tabIndex={-1}>
          {banner && !bannerDismissed && (
            <div className="banner" role="status">
              <p>{banner}</p>
              <button type="button" className="btn btn--quiet" onClick={() => setBannerDismissed(true)}>
                OK
              </button>
            </div>
          )}
          {screen}
        </main>
      </div>
      <Notices visibleConversationId={conversationId} />
    </div>
  );
}
