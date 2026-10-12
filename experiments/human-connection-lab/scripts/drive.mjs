/**
 * Walks through Halfway the way a first-time visitor would, in a real
 * browser, and fails loudly if anything on the main path doesn't work.
 *
 *   node scripts/drive.mjs [baseUrl]      (default http://localhost:4317/)
 *
 * It uses the Chrome or Edge already installed on this machine (through
 * playwright-core, which downloads no browser). Set CHROME_PATH to override.
 * Screenshots of every step at phone, tablet and desktop size go to
 * ./screenshots so the rendered result can be inspected, not just assumed.
 *
 * A page that loads is not a page that works: this drives the whole arc —
 * write, seal, lean, meet, choose, write, open, reply, knock, keep — and checks the rule
 * that matters most along the way: nothing of anyone else's is readable
 * before your own half is sealed.
 */

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4317/';
const OUT = new URL('../screenshots/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');

const SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
  console.log(`${ok ? '  ok ' : '  FAIL'} ${message}`);
};

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: SIZES.phone, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

async function shot(name) {
  await page.waitForTimeout(650); // let entrances and the opening finish
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: false });
}

async function noSideways(label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: no horizontal scrolling (${overflow}px)`);
}

/** Deliver every pending simulated reply through the demo control, then come back. */
async function hurry() {
  const back = page.url();
  await page.goto(new URL('#/you', BASE).href);
  // Labelled "Hurry the others (n on the way)", or "Nothing on its way" when idle.
  const btn = page.locator('.demo__controls button').first();
  await btn.waitFor();
  if (await btn.isEnabled()) await btn.click();
  await page.goto(back);
}

const LONG =
  'My neighbour has started leaving a chair outside her door every evening. Nobody sits in it. I think it is an invitation, and I keep almost accepting.';

console.log('Phone — first visit');
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole('heading', { level: 1 }).waitFor();
check(await page.getByText('Your half').first().isVisible(), 'the first screen offers a place to write');
check((await page.locator('.commons-row .voice').count()) === 0, 'nobody else’s half is readable before sealing');
check((await page.locator('.redacted').count()) >= 8, 'others’ halves are shown as sealed lines');
check(await page.getByRole('button', { name: 'Seal my half' }).isDisabled(), 'sealing waits for a real half');
await noSideways('today, phone');
await shot('01-phone-today-first-visit');

await page.goto(new URL('#/conversations', BASE).href);
check(await page.getByText('No conversations yet.').isVisible(), 'an empty conversation list explains how one begins');
await shot('01b-phone-conversations-empty');
await page.goto(new URL('#/how', BASE).href);
check(await page.getByText('Nobody goes first.').isVisible(), 'the rule is explained in one line');
await noSideways('how it works, phone');
await shot('01c-phone-how');
await page.goto(new URL('#/today', BASE).href);
await page.getByRole('textbox').waitFor();

await page.getByRole('textbox').fill('Too short');
check(await page.getByText(/more characters? to seal/).isVisible(), 'the composer says how much more is needed');
await page.getByRole('textbox').fill(LONG);
await shot('02-phone-today-writing');
await page.getByRole('button', { name: 'Seal my half' }).click();
check((await page.locator('.commons-row .voice').count()) === 8, 'sealing opens everyone else’s halves');
await shot('03-phone-today-open');

console.log('Phone — leaning in');
const firstLean = page.getByRole('button', { name: /^Lean in toward/ }).first();
await firstLean.click();
check(await page.getByText('Leaned in').first().isVisible(), 'a lean shows as your half of a mutual choice');
check(await page.getByText(/2 of 3 leans left/).isVisible(), 'the daily lean allowance counts down');
await shot('04-phone-leaned');
await page.locator('.notice').waitFor({ timeout: 20_000 });
check(await page.getByText(/both leaned in/).isVisible(), 'a returned lean announces the new conversation');
await shot('05-phone-mutual-notice');
await page.locator('.notice__action').click();

/** Plays one round from wherever the conversation stands, and (by default) replies under it. */
async function playRound(replyAfter = true) {
  await hurry();
  const next = page.getByRole('button', { name: /^Next question/ });
  if (await next.isVisible()) {
    await next.click();
    await hurry();
  }
  if (await page.locator('.choice').first().isVisible()) await page.locator('.choice').first().click();
  const field = page.locator('.composer--inline textarea');
  if (await field.isVisible()) {
    await field.fill(LONG);
    await page.getByRole('button', { name: 'Seal my half' }).click();
  }
  await hurry();
  const open = page.getByRole('button', { name: 'Open both halves' });
  await open.waitFor({ timeout: 5_000 });
  await open.click();
  if (replyAfter) {
    await page.getByRole('button', { name: 'Reply to their half' }).click();
    await page.locator('.reply-composer__field').fill('Tell me more about that?');
    await page.getByRole('button', { name: 'Send reply' }).click();
  }
  await hurry();
}

async function knockOn(title, value) {
  await page.getByRole('button', { name: `Knock on “${title}”` }).click();
  if (value) {
    await page.locator('.door__share .field__input').fill(value);
    await page.locator('.door__share').getByRole('button', { name: 'Knock' }).click();
  }
}

/** Keeps talking until a door's opening appears, the way a real pair would. */
async function untilOpened(text, maxRounds = 4) {
  for (let i = 0; i <= maxRounds; i++) {
    await hurry();
    if (await page.getByText(text).first().isVisible()) return true;
    if (i < maxRounds) await playRound();
  }
  return false;
}

console.log('Phone — the first round');
await page.getByText('Your turn to choose the next question.').waitFor();
check(await page.getByText('Where you met').isVisible(), 'the conversation starts from the question where you met');
await noSideways('conversation, phone');
await shot('06-phone-choose-question');
await page.locator('.choice').first().click();
await page.locator('.composer--inline textarea').waitFor();
await shot('07-phone-write-half');
await page.locator('.composer--inline textarea').fill(LONG);
await page.getByRole('button', { name: 'Seal my half' }).click();
await hurry();
await page.getByRole('button', { name: 'Open both halves' }).waitFor();
await shot('08-phone-ready-to-open');
await page.getByRole('button', { name: 'Open both halves' }).click();
await shot('09-phone-opened');
check(await page.getByRole('button', { name: 'Reply to their half' }).isVisible(), 'an opened round invites a reply');
check(!(await page.locator('.choice').first().isVisible()), 'nothing moves on to the next question by itself');

console.log('Phone — replying to a line');
await page.getByRole('button', { name: 'Reply to their half' }).click();
await page.getByRole('button', { name: 'Reply to a line from their half' }).click();
await shot('10-phone-pick-a-line');
await page.locator('.line').first().click();
await page.locator('.reply-composer__field').fill('I keep thinking about this. What happened next?');
await shot('11-phone-reply-with-quote');
await page.getByRole('button', { name: 'Send reply' }).click();
check((await page.locator('.reply--me .reply__quote').count()) === 1, 'a reply carries the line it answers');
await hurry();
check((await page.locator('.reply--them').count()) >= 1, 'they reply under the round');
await shot('12-phone-thread');

console.log('Phone — doors');
check(await page.getByRole('button', { name: 'Knock on “Share first names”' }).isVisible(), 'the names door appears after the first round');
await knockOn('Share first names', 'Sam');
// Either they hadn't knocked yet (the knock waits, visibly yours alone), or they
// already had (it opens at once). Both are correct; what must never happen is a
// third state that shows their knock without yours.
const waiting = await page.getByText(/You knocked\. It opens if they knock too/).isVisible();
const opened = await page.getByText('You both shared your first names.').first().isVisible();
check(waiting !== opened, `a knock either waits as yours alone or opens at once (${waiting ? 'waiting' : 'opened'})`);
await shot('13-phone-knocked');
check(await untilOpened('You both shared your first names.'), 'the names door opens once both have knocked');
check(!(await page.getByRole('heading', { level: 1 }).textContent()).startsWith('Someone'), 'their first name replaces “someone in …”');
await shot('14-phone-names-open');

await playRound();
check(await page.getByRole('button', { name: 'Knock on “Go a little deeper”' }).isVisible(), 'going deeper is offered after two light rounds');
await knockOn('Go a little deeper');
check(await untilOpened('You both chose to go a little deeper.'), 'the conversation goes deeper only through a door both opened');
await playRound();
check((await page.locator('.round-block .exchange__head .meta').last().textContent()).includes('Closer'), 'new questions reach a little further in');

check(await page.getByRole('button', { name: 'Knock on “Keep meeting here”' }).isVisible(), 'keeping each other is offered');
await knockOn('Keep meeting here');
check(await untilOpened('You both chose to keep meeting here.', 5), 'two people can keep each other');
await shot('15-phone-kept');

console.log('Options and safety');
await page.getByRole('button', { name: 'Conversation options' }).click();
await shot('16-phone-options-sheet');
await page.keyboard.press('Escape');
const convoUrl = page.url();

console.log('Your people, the next day');
await page.goto(new URL('#/you', BASE).href);
await page.getByRole('button', { name: 'Skip to tomorrow' }).click();
await page.goto(new URL('#/today', BASE).href);
const people = page.getByRole('region', { name: 'Your people' });
check(await people.isVisible(), 'the people you keep have a place on Today');
check((await people.locator('.redacted').count()) === 1, 'their half stays sealed until you write yours');
await shot('17-phone-your-people-sealed');
await page.getByRole('textbox').fill(LONG);
await page.getByRole('button', { name: 'Seal my half' }).click();
check((await people.locator('.voice').count()) === 1, 'once you’ve written, their answer is there');
await people.scrollIntoViewIfNeeded();
await shot('18-phone-your-people-open');

console.log('Other sizes and dark mode');
for (const [name, size] of Object.entries(SIZES)) {
  await page.setViewportSize(size);
  await page.goto(new URL('#/today', BASE).href);
  await noSideways(`today, ${name}`);
  await shot(`20-${name}-today`);
  await page.goto(convoUrl);
  await page.locator('.convo-head').waitFor();
  await noSideways(`conversation, ${name}`);
  await shot(`21-${name}-conversation`);
  await page.goto(new URL('#/conversations', BASE).href);
  await shot(`22-${name}-list`);
}
await page.emulateMedia({ colorScheme: 'dark' });
await page.setViewportSize(SIZES.phone);
await page.goto(convoUrl);
await shot('30-phone-dark-conversation');
await page.goto(new URL('#/today', BASE).href);
await shot('31-phone-dark-today');
await page.setViewportSize(SIZES.desktop);
await page.goto(convoUrl);
await shot('32-desktop-dark-conversation');

console.log('Persistence');
await page.reload();
await page.locator('.convo-head').waitFor();
check(await page.getByText('Where you met').isVisible(), 'the world survives a reload');
check(await page.getByText('You both chose to keep meeting here.').isVisible(), 'opened doors survive a reload');

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nAll checks passed. Screenshots in ./screenshots');
