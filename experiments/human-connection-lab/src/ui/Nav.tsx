/**
 * The three places Halfway has. A bottom bar on phones (where the thumb is),
 * a rail on the start edge from tablet width up — same destinations, same order.
 */

import { hrefFor, type Route } from '../state/router';

interface Props {
  route: Route;
  /** Conversations waiting on the visitor — a count about their own to-dos, never about people. */
  waiting: number;
}

const ITEMS = [
  { name: 'today', label: 'Today' },
  { name: 'conversations', label: 'Conversations' },
  { name: 'you', label: 'You' },
] as const;

export function Nav({ route, waiting }: Props) {
  const current = route.name === 'how' ? 'you' : route.name;
  return (
    <nav className="nav" aria-label="Main">
      <ul className="nav__list">
        {ITEMS.map((item) => (
          <li key={item.name}>
            <a
              className={`nav__item ${current === item.name ? 'is-current' : ''}`}
              href={hrefFor({ name: item.name } as Route)}
              aria-current={current === item.name ? 'page' : undefined}
            >
              <NavIcon name={item.name} />
              <span className="nav__label">{item.label}</span>
              {item.name === 'conversations' && waiting > 0 && (
                <span className="nav__count" aria-label={`${waiting} waiting for you`}>
                  {waiting}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Line icons drawn for Halfway: a question mark of a day, a seam, a single mark for the self. */
function NavIcon({ name }: { name: (typeof ITEMS)[number]['name'] }) {
  return (
    <svg className="nav__icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {name === 'today' && (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 9.5h16M9 3v4M15 3v4" />
        </>
      )}
      {name === 'conversations' && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M12 5v14" strokeDasharray="2 2" />
        </>
      )}
      {name === 'you' && (
        <>
          <circle cx="12" cy="9" r="3.5" />
          <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
        </>
      )}
    </svg>
  );
}
