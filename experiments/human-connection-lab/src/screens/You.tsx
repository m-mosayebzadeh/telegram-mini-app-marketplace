/**
 * You — not a profile. Halfway has none.
 *
 * This page holds what is the visitor's own: their daily halves, what they
 * have typed when choosing to share (shown to nobody without a mutual
 * choice), and the controls of the demo world, said plainly as such.
 */

import { useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { useWorld } from '../state/WorldContext';
import { hrefFor } from '../state/router';
import { questionById, type RevealKind } from '../domain/questions';
import { hurry, skipToTomorrow } from '../domain/world';
import { formatShortDay } from './format';

const KINDS: RevealKind[] = ['name', 'work'];
const KIND_LABEL: Record<RevealKind, string> = { name: 'First name', work: 'What you do' };

export function You() {
  const { world, act, actReal, reset, storage } = useWorld();
  const [confirmReset, setConfirmReset] = useState(false);
  const closeReset = () => setConfirmReset(false);
  const halves = world.days.filter((d) => d.mine).sort((a, b) => b.dayIndex - a.dayIndex);
  const pending = world.pending.length;

  return (
    <div className="screen screen--you">
      <header className="screen-head">
        <h1 className="title">You</h1>
        <p className="screen-head__sub">There is no profile here. Only what you choose to share, one person at a time.</p>
      </header>

      <section className="you-section" aria-labelledby="shared-title">
        <h2 className="heading" id="shared-title">
          What you’d share
        </h2>
        <p className="you-section__body">
          Filled in when you knock on a door to share. Nobody sees any of it unless they knocked on the same door
          too.
        </p>
        <dl className="facts">
          {KINDS.map((k) => (
            <div className="facts__row" key={k}>
              <dt>{KIND_LABEL[k]}</dt>
              <dd className={world.me[k] ? '' : 'is-empty'}>{world.me[k] ?? 'Not shared with anyone yet'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="you-section" aria-labelledby="halves-title">
        <h2 className="heading" id="halves-title">
          Your daily halves
        </h2>
        {halves.length === 0 ? (
          <p className="you-section__body">
            Your answers to the daily question will collect here.{' '}
            <a className="inline-link" href={hrefFor({ name: 'today' })}>
              Answer today’s
            </a>
          </p>
        ) : (
          <ol className="archive">
            {halves.map((d) => (
              <li key={d.dayIndex} className="archive__item">
                <p className="stamp">{formatShortDay(d.mine!.sealedAt)}</p>
                <p className="archive__question">{questionById(d.questionId).text}</p>
                <p className="voice">{d.mine!.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="you-section" aria-labelledby="how-title">
        <h2 className="heading" id="how-title">
          How Halfway works
        </h2>
        <p className="you-section__body">One rule, everywhere: nobody goes first.</p>
        <a className="btn btn--quiet" href={hrefFor({ name: 'how' })}>
          Read how it works
        </a>
      </section>

      <section className="you-section demo" aria-labelledby="demo-title">
        <h2 className="heading" id="demo-title">
          Demo world
        </h2>
        <p className="you-section__body">
          The other people here are eight invented characters living in this browser. They reply in seconds instead
          of hours, and they can’t read what you write. Nothing leaves this device.
        </p>
        <div className="demo__controls">
          <button
            type="button"
            className="btn btn--quiet"
            disabled={pending === 0}
            onClick={() => act((w, t) => hurry(w, t))}
          >
            {pending === 0 ? 'Nothing on its way' : `Hurry the others (${pending} on the way)`}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => actReal((w, r) => skipToTomorrow(w, r))}>
            Skip to tomorrow
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setConfirmReset(true)}>
            Reset this world
          </button>
        </div>
        <p className="meta">
          {storage === 'unavailable' || storage === 'failing'
            ? 'This browser isn’t letting Halfway save, so this world will be forgotten when the tab closes.'
            : 'Saved in this browser only.'}
        </p>
      </section>

      {confirmReset && (
        <Sheet title="Reset this world?" onClose={closeReset}>
          <p className="sheet__body">Every half, conversation and choice in this browser will be erased. This can’t be undone.</p>
          <div className="sheet__buttons">
            <button type="button" className="btn btn--quiet" onClick={closeReset}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                reset();
                closeReset();
                window.location.hash = hrefFor({ name: 'today' });
              }}
            >
              Erase and start over
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
