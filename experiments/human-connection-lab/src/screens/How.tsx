/**
 * How Halfway works — the rule, in the product's own words, and an honest
 * account of what in this demo is simulated.
 */

import { Seal } from '../ui/Seal';
import { hrefFor } from '../state/router';

const MOMENTS: { seal: 'none' | 'mine' | 'whole' | 'open'; title: string; body: string }[] = [
  {
    seal: 'none',
    title: 'Answer first, then read',
    body: 'Everyone gets the same question each day. Other people’s answers open once yours is sealed, so nobody reads without having written.',
  },
  {
    seal: 'mine',
    title: 'Lean in, privately',
    body: 'Lean toward up to three answers a day. A conversation opens only if they leaned toward yours too. A lean that isn’t returned is never shown to anyone.',
  },
  {
    seal: 'whole',
    title: 'Two halves, opened together — then talk',
    body: 'Each new question is answered in two sealed halves that open at the same moment. Once they’re open, you can reply to what they wrote, even to a single line of it. The seal protects the first step; after that, you talk.',
  },
  {
    seal: 'open',
    title: 'Doors that open from both sides',
    body: 'Going deeper, sharing first names, saying what you do, keeping each other: each is a door that opens only when you’ve both knocked. A knock that isn’t answered is never shown, and you can take yours back until the door opens.',
  },
];

export function How() {
  return (
    <div className="screen screen--how">
      <header className="screen-head">
        <a className="btn btn--quiet screen-head__back" href={hrefFor({ name: 'you' })}>
          ‹ You
        </a>
        <p className="stamp">How Halfway works</p>
        <h1 className="display">Nobody goes first.</h1>
        <p className="lead">
          Most ways of meeting people make someone go first, alone: first to present themselves, first to write, first
          to open up, first to ask for more, first to leave. Halfway is built so that never happens.
        </p>
      </header>

      <ol className="moments">
        {MOMENTS.map((m) => (
          <li key={m.title} className="moment">
            <Seal state={m.seal} size={28} decorative />
            <div>
              <h2 className="heading">{m.title}</h2>
              <p className="moment__body">{m.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="you-section">
        <h2 className="heading">Your pace, and gentle endings</h2>
        <p className="you-section__body">
          Nothing moves on until one of you asks for the next question, and questions only go deeper once you’ve both
          knocked on that door. When you keep each other, the conversation doesn’t end — their answer to each day’s
          question waits for you on Today. And you can let a conversation rest at any time with a closing line, so
          nothing ends in silence.
        </p>
      </section>

      <section className="you-section">
        <h2 className="heading">What is simulated in this demo</h2>
        <ul className="plain-list">
          <li>The other people are eight invented characters with pre-written answers. They can’t read what you write.</li>
          <li>They decide whether to lean back by a simple rule: longer halves are leaned toward more often. Your very first lean is always returned, so you can see a conversation begin.</li>
          <li>When you reply under their half, they answer once, with a pre-written continuation of their own answer. They can’t read your reply.</li>
          <li>They knock on doors by simple rules that reward replying to them: they go deeper only after you’ve responded to what they wrote. Some take a round longer than others.</li>
          <li>Time is compressed: replies take seconds rather than hours.</li>
          <li>There is no server. Everything is stored in this browser and nothing leaves it.</li>
        </ul>
      </section>
    </div>
  );
}
