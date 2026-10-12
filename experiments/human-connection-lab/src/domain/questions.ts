/**
 * Every question Halfway asks, and the doors a conversation can open.
 *
 * Questions are written to invite a small story rather than a fact ("what's a
 * food that tastes like a particular person" rather than "favourite food"),
 * because stories are what make two halves worth opening side by side — and
 * worth replying to.
 */

export interface Question {
  id: string;
  text: string;
}

/** The question of the day — the same for everyone, rotating by calendar day. */
export const DAILY_QUESTIONS: readonly Question[] = [
  { id: 'd-noticed', text: 'What’s a small thing you noticed this week that nobody else seemed to?' },
  { id: 'd-nine', text: 'What did you want to be when you were nine, and how much of it survived?' },
  { id: 'd-proud', text: 'What’s something you’re quietly proud of that never comes up in conversation?' },
  { id: 'd-place', text: 'Where have you felt most like yourself, and what was it about that place?' },
];

export type DepthIndex = 0 | 1 | 2;

export interface Depth {
  index: DepthIndex;
  /** A plain word for how far in a question reaches. */
  title: string;
  questions: readonly Question[];
}

/**
 * Three depths (social penetration theory: closeness comes from disclosure
 * that deepens gradually and is matched). A pair starts at Light and moves
 * deeper only through a door both have knocked on — never on a timetable.
 */
export const DEPTHS: readonly Depth[] = [
  {
    index: 0,
    title: 'Light',
    questions: [
      { id: 'l-morning', text: 'What does a good ordinary morning look like for you?' },
      { id: 'l-laugh', text: 'What’s the last thing that made you laugh out loud when you were alone?' },
      { id: 'l-skill', text: 'What’s a skill you’d love to have that has nothing to do with your work?' },
      { id: 'l-food', text: 'What’s a food that tastes like a particular person to you?' },
      { id: 'l-place', text: 'What’s a place near where you live that you’d show a visitor first?' },
      { id: 'l-sound', text: 'What’s a sound you hear every day that you’d miss if you moved away?' },
    ],
  },
  {
    index: 1,
    title: 'Closer',
    questions: [
      { id: 'c-changed', text: 'What’s something you changed your mind about in the last few years?' },
      { id: 'c-taught', text: 'Who taught you something important without meaning to?' },
      { id: 'c-week', text: 'What does your week hold that most people wouldn’t guess?' },
      { id: 'c-ease', text: 'When do you feel most at ease around other people?' },
      { id: 'c-habit', text: 'What’s a habit you’ve kept since childhood, and one you’ve dropped?' },
      { id: 'c-evening', text: 'What do you do with an evening that’s entirely yours?' },
    ],
  },
  {
    index: 2,
    title: 'Deep',
    questions: [
      { id: 'p-forgive', text: 'What are you still learning to forgive — in someone else, or in yourself?' },
      { id: 'p-hope', text: 'What’s a hope you rarely say out loud?' },
      { id: 'p-friend', text: 'What does a good friend do that you wish more people knew to do?' },
      { id: 'p-hard', text: 'What has been hard lately, and what has helped?' },
      { id: 'p-unsure', text: 'What’s something you were sure of about yourself that turned out not to be true?' },
      { id: 'p-thanks', text: 'Who would you like to thank, but never have?' },
    ],
  },
];

/** What a person may choose to reveal through a door. */
export type RevealKind = 'name' | 'work';

/**
 * A door is a threshold in a conversation. It opens only when both people
 * have knocked, and a knock nobody answers is never shown to anyone.
 */
export type DoorId = 'names' | 'closer' | 'work' | 'deep' | 'keep';

export interface Door {
  id: DoorId;
  title: string;
  /** What opening it means, said before anyone knocks. */
  body: string;
  /** Said once it has opened. */
  opened: string;
  reveal?: RevealKind;
}

export const DOORS: Record<DoorId, Door> = {
  names: {
    id: 'names',
    title: 'Share first names',
    body: 'You’ll each see the other’s first name.',
    opened: 'You both shared your first names.',
    reveal: 'name',
  },
  closer: {
    id: 'closer',
    title: 'Go a little deeper',
    body: 'New questions will reach a little further in.',
    opened: 'You both chose to go a little deeper.',
  },
  work: {
    id: 'work',
    title: 'Share what you do',
    body: 'You’ll each see a line about what the other does.',
    opened: 'You both shared what you do.',
    reveal: 'work',
  },
  deep: {
    id: 'deep',
    title: 'Go deep',
    body: 'New questions will ask about what matters and what’s hard.',
    opened: 'You both chose to go deep.',
  },
  keep: {
    id: 'keep',
    title: 'Keep meeting here',
    body: 'This becomes a lasting connection. You’ll see each other’s answer to the daily question, and keep talking here.',
    opened: 'You both chose to keep meeting here.',
  },
};

/** The order doors are listed in. */
export const DOOR_ORDER: readonly DoorId[] = ['names', 'closer', 'work', 'deep', 'keep'];

const ALL_QUESTIONS = new Map<string, Question>(
  [...DAILY_QUESTIONS, ...DEPTHS.flatMap((d) => d.questions)].map((q) => [q.id, q]),
);

const DEPTH_OF = new Map<string, DepthIndex>(DEPTHS.flatMap((d) => d.questions.map((q) => [q.id, d.index] as const)));

export function questionById(id: string): Question {
  const q = ALL_QUESTIONS.get(id);
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}

/** The depth a conversation question belongs to. */
export function depthOf(questionId: string): DepthIndex {
  const d = DEPTH_OF.get(questionId);
  if (d === undefined) throw new Error(`Not a conversation question: ${questionId}`);
  return d;
}

export function dailyQuestionFor(dayIndex: number): Question {
  // Modulo that stays positive even if the clock is ever set backwards.
  const i = ((dayIndex % DAILY_QUESTIONS.length) + DAILY_QUESTIONS.length) % DAILY_QUESTIONS.length;
  return DAILY_QUESTIONS[i]!;
}

/** Wording for each kind of reveal, kept with the data so screens stay consistent. */
export const REVEAL_COPY: Record<RevealKind, { field: string; placeholder: string }> = {
  name: { field: 'Your first name', placeholder: 'First name' },
  work: { field: 'What you do, in a few words', placeholder: 'e.g. teach maths in Nairobi' },
};
