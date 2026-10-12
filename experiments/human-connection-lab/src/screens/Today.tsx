/**
 * Today — where Halfway opens, where people are found, and where the people
 * you've kept are waiting.
 *
 * The first thing anyone sees is a question and a place to answer it. Other
 * people's answers are right below, visible only as sealed lines until yours
 * is sealed: the reason to write is on screen, and nobody reads first. The
 * same rule holds for the people you've kept — a small daily ritual no
 * messaging app has: you see how they answered only once you have.
 */

import { Composer } from '../ui/Composer';
import { Redacted } from '../ui/Redacted';
import { Seal } from '../ui/Seal';
import { useWorld } from '../state/WorldContext';
import { hrefFor } from '../state/router';
import { dailyQuestionFor } from '../domain/questions';
import {
  LEANS_PER_DAY,
  commonsFor,
  conversationWith,
  displayName,
  keptConversations,
  lean,
  leansLeft,
  sealDailyHalf,
  today,
  unlean,
  type CommonsEntry,
  type DayState,
  type World,
} from '../domain/world';
import { formatDay, formatTime } from './format';

export function Today() {
  const { world, now, act } = useWorld();
  const day = today(world, now);
  const question = dailyQuestionFor(day.dayIndex);
  const kept = keptConversations(world);
  const keptIds = new Set(kept.map((c) => c.personId));
  // People you've kept appear under "Your people", not among strangers.
  const commons = commonsFor(world, day.dayIndex).filter((e) => !keptIds.has(e.personId));
  const allToday = commonsFor(world, day.dayIndex);
  const sealed = Boolean(day.mine);

  return (
    <div className="screen screen--today">
      <header className="today-head">
        <p className="stamp">
          {formatDay(now)} · Today’s question
        </p>
        <h1 className="display">{question.text}</h1>
      </header>

      {day.mine ? (
        <section className="my-half" aria-label="Your half">
          <div className="my-half__head">
            <Seal state="mine" size={16} decorative />
            <p className="stamp stamp--seal">Your half · sealed {formatTime(day.mine.sealedAt)}</p>
          </div>
          <p className="voice">{day.mine.text}</p>
        </section>
      ) : (
        <Composer
          label="Your half"
          hint="Everyone else’s halves open when yours is sealed."
          onSeal={(text) => act((w, t) => sealDailyHalf(w, t, text))}
        />
      )}

      {kept.length > 0 && (
        <section className="people" aria-labelledby="people-title">
          <div className="section-head">
            <h2 className="heading" id="people-title">
              Your people
            </h2>
            <p className="section-head__meta">{sealed ? 'Their halves today' : 'Open when yours is sealed'}</p>
          </div>
          <ol className="commons__list">
            {kept.map((c) => {
              const entry = allToday.find((e) => e.personId === c.personId);
              return (
                <li key={c.id} className="commons-row commons-row--person">
                  <p className="person-row__name">{displayName(c)}</p>
                  {sealed && entry ? <p className="voice">{entry.text}</p> : <Redacted label="Sealed until you seal yours" />}
                  <div className="commons-row__foot">
                    <p className="meta">{entry?.city}</p>
                    <a className="lean lean--met" href={hrefFor({ name: 'conversations', id: c.id })}>
                      <Seal state="open" size={16} decorative />
                      <span>Open conversation</span>
                    </a>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="commons" aria-labelledby="commons-title">
        <div className="section-head">
          <h2 className="heading" id="commons-title">
            Today’s halves
          </h2>
          <p className="section-head__meta">
            {sealed
              ? `${leansLeft(day)} of ${LEANS_PER_DAY} leans left today`
              : `${commons.length} people have sealed theirs`}
          </p>
        </div>
        <p className="commons__explain">
          {sealed
            ? 'Lean in toward answers that speak to you. A lean stays private unless they lean toward yours too — then a conversation opens.'
            : 'Seal your half to read them.'}
        </p>
        <ol className="commons__list">
          {commons.map((entry) => (
            <CommonsRow key={entry.personId} entry={entry} day={day} world={world} sealed={sealed} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function CommonsRow({ entry, day, world, sealed }: { entry: CommonsEntry; day: DayState; world: World; sealed: boolean }) {
  const { act } = useWorld();
  const met = conversationWith(world, entry.personId);
  const leaned = day.leans.includes(entry.personId);
  const outOfLeans = leansLeft(day) <= 0;

  return (
    <li className={`commons-row ${leaned ? 'is-leaned' : ''}`}>
      {sealed ? <p className="voice">{entry.text}</p> : <Redacted label="Sealed until you seal yours" />}
      <div className="commons-row__foot">
        <p className="meta">
          {entry.city}
          {sealed && entry.wroteAt ? ` · written at ${entry.wroteAt} their time` : ''}
        </p>
        {sealed &&
          (met ? (
            <a className="lean lean--met" href={hrefFor({ name: 'conversations', id: met.id })}>
              <Seal state="open" size={16} decorative />
              <span>You’ve met · Open</span>
            </a>
          ) : leaned ? (
            <button
              type="button"
              className="lean lean--leaned"
              aria-pressed="true"
              aria-label={`Leaned in toward the half from ${entry.city}. Undo.`}
              onClick={() => act((w, t) => unlean(w, t, entry.personId))}
            >
              <Seal state="mine" size={16} decorative />
              <span>Leaned in</span>
              <span className="lean__undo">Undo</span>
            </button>
          ) : (
            <button
              type="button"
              className="lean"
              aria-pressed="false"
              aria-label={`Lean in toward the half from ${entry.city}`}
              disabled={outOfLeans}
              onClick={() => act((w, t) => lean(w, t, entry.personId))}
            >
              <Seal state="none" size={16} decorative />
              <span>{outOfLeans ? 'No leans left' : 'Lean in'}</span>
            </button>
          ))}
      </div>
    </li>
  );
}
