import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { WorldProvider } from './state/WorldContext';
import { OLD_STORAGE_KEY, saveWorld } from './domain/storage';
import {
  createWorld,
  hurry,
  knock,
  lean,
  nextQuestion,
  openRound,
  phaseOf,
  pickQuestion,
  reply,
  sealDailyHalf,
  sealRoundHalf,
  type World,
} from './domain/world';

const T0 = new Date(2026, 9, 12, 12).getTime();
const clock = () => T0;
const HALF = 'Something I noticed, written with enough care to count.';

function renderApp(hash = '#/today', storage: Storage = window.localStorage) {
  window.location.hash = hash;
  return render(
    <WorldProvider storage={storage} clock={clock}>
      <App />
    </WorldProvider>,
  );
}

/** A saved world with one conversation with `personId`, advanced by `steps`. */
function seedConversation(steps: (w: World, id: string) => World = (w) => w, personId = 'mira'): string {
  let w = createWorld(T0, 11);
  w = hurry(lean(sealDailyHalf(w, T0, HALF), T0, personId), T0);
  const id = w.conversations[0]!.id;
  w = steps(w, id);
  saveWorld(window.localStorage, { ...w, notices: [] });
  return id;
}

/** Plays a round until both halves are in and waiting to be opened. */
function toReady(w: World, id: string): World {
  w = hurry(w, T0);
  if (phaseOf(w.conversations.find((c) => c.id === id)!).kind === 'between') w = hurry(nextQuestion(w, T0, id), T0);
  const phase = phaseOf(w.conversations.find((c) => c.id === id)!);
  if (phase.kind === 'pick') w = pickQuestion(w, T0, id, phase.offer.questionIds[0]!);
  w = hurry(w, T0);
  w = sealRoundHalf(w, T0, id, HALF);
  return hurry(w, T0);
}

function playRounds(w: World, id: string, n: number): World {
  for (let i = 0; i < n; i++) w = openRound(toReady(w, id), T0, id);
  return hurry(w, T0);
}

describe('first visit', () => {
  it('opens on today’s question, with everyone else’s halves sealed until yours is', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/noticed this week/);
    expect(screen.getAllByRole('img', { name: 'Sealed until you seal yours' })).toHaveLength(8);
    const seal = screen.getByRole('button', { name: 'Seal my half' });
    expect(seal).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Your half' }), 'Too short');
    expect(screen.getByText(/more characters? to seal/)).toBeInTheDocument();
    expect(seal).toBeDisabled();

    await user.clear(screen.getByRole('textbox', { name: 'Your half' }));
    await user.type(screen.getByRole('textbox', { name: 'Your half' }), HALF);
    await user.click(seal);

    expect(screen.queryAllByRole('img', { name: 'Sealed until you seal yours' })).toHaveLength(0);
    expect(screen.getByText(/The cherry tree outside my shop/)).toBeInTheDocument();
    expect(screen.getByText(HALF)).toBeInTheDocument();
    // Sealed is final: the composer is gone.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('lets you lean in up to three times, and take a lean back', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByRole('textbox', { name: 'Your half' }), HALF);
    await user.click(screen.getByRole('button', { name: 'Seal my half' }));

    const leanButtons = () => screen.getAllByRole('button', { name: /^Lean in toward/ });
    await user.click(leanButtons()[0]!);
    expect(screen.getByText('2 of 3 leans left today')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    expect(screen.getByText('3 of 3 leans left today')).toBeInTheDocument();

    for (let i = 0; i < 3; i++) await user.click(leanButtons()[0]!);
    expect(screen.getByText('0 of 3 leans left today')).toBeInTheDocument();
    for (const b of leanButtons()) expect(b).toBeDisabled();
  });

  it('explains that there are no conversations yet, with a way forward', () => {
    renderApp('#/conversations');
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to today’s question' })).toHaveAttribute('href', '#/today');
  });
});

describe('a conversation', () => {
  it('starts on your turn to choose, and creates the round you pick', async () => {
    const user = userEvent.setup();
    const id = seedConversation();
    renderApp(`#/conversations/${id}`);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone in Lisbon');
    expect(screen.getByLabelText('Where you met')).toHaveTextContent(HALF);
    await user.click(screen.getAllByRole('button', { name: /Ask this/ })[0]!);
    expect(screen.getByRole('textbox', { name: 'Your half' })).toBeInTheDocument();
    expect(screen.getByText(/You chose · Light/)).toBeInTheDocument();
  });

  it('keeps their half sealed until you open both together', async () => {
    const user = userEvent.setup();
    const id = seedConversation(toReady);
    renderApp(`#/conversations/${id}`);

    expect(screen.getByText('Both halves are in.')).toBeInTheDocument();
    const round = screen.getAllByRole('article').at(-1)!;
    expect(within(round).getByRole('img', { name: /Sealed — opens when both/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open both halves' }));
    expect(within(round).queryByRole('img', { name: /Sealed — opens when both/ })).not.toBeInTheDocument();
    expect(round.querySelector('.half--theirs .voice')?.textContent?.length).toBeGreaterThan(10);
  });

  it('lets you reply to a line of their half once it’s open, instead of pushing you to the next question', async () => {
    const user = userEvent.setup();
    const id = seedConversation((w, cid) => playRounds(w, cid, 1));
    renderApp(`#/conversations/${id}`);

    // Nothing has moved on by itself: you reply, or ask for the next question.
    expect(screen.getByRole('button', { name: /Next question · they choose/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reply to their half' }));
    await user.click(screen.getByRole('button', { name: 'Reply to a line from their half' }));
    const lines = within(screen.getByRole('group', { name: /Lines from/ })).getAllByRole('button');
    const quoted = lines[0]!.textContent!;
    await user.click(lines[0]!);
    await user.type(screen.getByRole('textbox', { name: 'Your reply' }), 'What happened then?');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const replies = screen.getAllByRole('list', { name: 'Replies' }).at(-1)!;
    expect(within(replies).getByText('What happened then?')).toBeInTheDocument();
    expect(within(replies).getByText(quoted)).toBeInTheDocument();
    // Once you've responded, moving on leads instead of another invitation to reply.
    expect(screen.queryByRole('button', { name: 'Reply to their half' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next question/ })).toHaveClass('btn--primary');
  });

  it('shows a door you knocked on as yours alone, and lets you take the knock back', async () => {
    const user = userEvent.setup();
    // Hiro is a round slower to share names, so after one round his knock hasn't come.
    const id = seedConversation((w, cid) => playRounds(w, cid, 1), 'hiro');
    renderApp(`#/conversations/${id}`);

    await user.click(screen.getByRole('button', { name: 'Knock on “Share first names”' }));
    await user.type(screen.getByRole('textbox', { name: 'Your first name' }), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Knock' }));
    expect(screen.getByText(/You knocked\. It opens if they knock too/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone in Osaka');

    await user.click(screen.getByRole('button', { name: /Take back your knock/ }));
    expect(screen.getByRole('button', { name: 'Knock on “Share first names”' })).toBeInTheDocument();
  });

  it('shows a first name only once both have knocked', () => {
    const id = seedConversation((w, cid) => hurry(knock(playRounds(w, cid, 1), T0, cid, 'names', 'Sam'), T0));
    renderApp(`#/conversations/${id}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mira');
    expect(screen.getByText(/You both shared your first names\. They’re Mira\./)).toBeInTheDocument();
  });

  it('puts the people you keep on Today, sealed until you’ve written your half', async () => {
    const user = userEvent.setup();
    seedConversation((w, cid) => {
      w = playRounds(w, cid, 4);
      const last = w.conversations[0]!.rounds.at(-1)!;
      w = reply(w, T0, cid, last.id, 'Thank you for telling me that.');
      return hurry(knock(w, T0, cid, 'keep'), T0);
    }, 'tomasz');
    // A new day: their answer to the new question waits behind yours.
    window.localStorage.setItem(
      'halfway.world.v2',
      JSON.stringify({ ...JSON.parse(window.localStorage.getItem('halfway.world.v2')!), clockOffset: 24 * 60 * 60 * 1000 }),
    );
    renderApp('#/today');

    const people = screen.getByRole('region', { name: 'Your people' });
    expect(within(people).getByRole('img', { name: 'Sealed until you seal yours' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your half' }), HALF);
    await user.click(screen.getByRole('button', { name: 'Seal my half' }));
    expect(within(people).getByText(/hospital vending machine|Gagarin|astronaut/)).toBeInTheDocument();
  });

  it('lets you rest a conversation with a closing line instead of silence', async () => {
    const user = userEvent.setup();
    const id = seedConversation();
    renderApp(`#/conversations/${id}`);

    await user.click(screen.getByRole('button', { name: 'Conversation options' }));
    await user.click(screen.getByRole('button', { name: /Let it rest/ }));
    await user.click(screen.getByRole('button', { name: 'Let it rest' }));
    expect(screen.getByText('You let this conversation rest.')).toBeInTheDocument();
    expect(screen.getByText(/glad we met halfway/)).toBeInTheDocument();
  });

  it('says why a world from the first version starts fresh', () => {
    window.localStorage.setItem(OLD_STORAGE_KEY, '{"version":1}');
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent(/Halfway has changed since your last visit/);
    expect(window.localStorage.getItem(OLD_STORAGE_KEY)).toBeNull();
  });
});

describe('when the browser won’t save', () => {
  it('still works, and says plainly that the world will be forgotten', async () => {
    const user = userEvent.setup();
    // Like some private browsing modes: every read and write throws.
    const refusing = {
      length: 0,
      clear() {},
      key: () => null,
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {},
    } as Storage;
    renderApp('#/today', refusing);
    expect(screen.getByRole('status')).toHaveTextContent(/won’t be|isn’t letting Halfway save/);
    await user.type(screen.getByRole('textbox', { name: 'Your half' }), HALF);
    await user.click(screen.getByRole('button', { name: 'Seal my half' }));
    expect(screen.getByText(HALF)).toBeInTheDocument();
  });
});
