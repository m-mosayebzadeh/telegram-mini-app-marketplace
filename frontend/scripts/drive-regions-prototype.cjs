// Drives docs/prototypes/regions.html the way a person would, in a simulated
// browser: taps, waits, and time moved forward on purpose. Every scenario
// starts from a fresh page and prints PASS/FAIL per check.
//
// Run it before publishing the prototype — a page that loads is not a page
// that works, and twice a change that only checked loading shipped broken:
//
//   cd frontend && node scripts/drive-regions-prototype.cjs ../docs/prototypes/regions.html
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let failures = 0;

function page() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push((e.detail && e.detail.message) || e.message));
  const clock = { offset: 0 };
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>', {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false });
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
      w.Element.prototype.setPointerCapture = () => {};
      w.Element.prototype.animate = function () { const a = { onfinish: null }; setTimeout(() => a.onfinish && a.onfinish(), 50); return a; };
      const real = w.performance.now.bind(w.performance);
      w.performance.now = () => real() + clock.offset;
    },
  });
  const w = dom.window, d = w.document;
  let target = null;
  d.elementFromPoint = () => target;
  const api = {
    w, d, clock, errors,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    tap(el) {
      target = el;
      for (const type of ['pointerdown', 'pointerup']) {
        const ev = new w.Event(type, { bubbles: true, cancelable: true });
        Object.assign(ev, { pointerId: 1, clientX: 100, clientY: 100 });
        el.dispatchEvent(ev);
      }
    },
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    text: (sel) => ((d.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    row: (name) => [...d.querySelectorAll('.row')].find((r) => r.textContent.includes(name)),
    async toTalk() {
      // A tap is one step closer to the menu: from another region it first
      // brings you home, and the next tap opens the menu.
      const sol = d.getElementById('sol');
      for (let i = 0; i < 3 && !d.getElementById('sol-area').classList.contains('tapmode'); i += 1) {
        api.tap(sol); await api.sleep(1300);
      }
      api.click([...d.querySelectorAll('.sat')].find((s) => s.textContent.includes('گفتگوها')));
      await api.sleep(250);
      api.midFlight = [...d.querySelectorAll('.row.here')].length;
      await api.sleep(1600);
    },
  };
  return api;
}
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  // ------------------------------------------------------------ the look
  // Behaviour can be perfect while the page looks broken: once a careless
  // edit deleted eleven blocks of styling, every behaviour check still
  // passed, and the owner saw a card that would not turn over and a filter
  // hidden behind the sky. So every component's styling must be present.
  {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const needed = ['.orb-body {', '.online-ring {', '.sat {', '.sol {', '.hole {', '.item {', '.item.flipper', '.flip-in',
      '.fside {', '.fside-back', '.flip-act', '.burn-edge', '.ember {', '.undo-tip {', '.to-sol {', '.sol.absorb', '.row {', '.row.ghost.here',
      '.row.needs.here', '.chips {', '.thread-layer {', '.sbar {', '.band {', '.band-foot', '.req {', '.release {',
      '.clock {', '.gift {', '.spark {', '.react-chip'];
    const missing = needed.filter((sel) => !css.includes(sel));
    check('look: every component still has its styling', missing.length === 0, missing.join(' '));
  }

  // ---------------------------------------------------------------- news
  {
    const P = page(); await P.sleep(300);
    P.click(P.d.getElementById('badge')); await P.sleep(1000);
    const buy = P.d.querySelector('.item.flipper');
    check('news: Shabnam item is there, worded without "buying"', !!buy && !buy.textContent.includes('بخر'), buy && buy.querySelector('b').textContent);
    const cs = (el) => P.w.getComputedStyle(el);
    const items = [...P.d.querySelectorAll('#stream .item')];
    check('look: every news card is the same width, measured the same way',
      items.every((el) => cs(el).boxSizing === 'border-box') && new Set(items.map((el) => el.style.width)).size === 1,
      [...new Set(items.map((el) => el.style.width))].join(' '));
    check('look: the card really is two-sided (faces stacked, back turned away)',
      cs(buy.querySelector('.flip-in')).position === 'absolute' && /rotateX\(180deg\)/.test(cs(buy.querySelector('.fside-back')).transform));
    P.tap(buy.querySelector('.fside-front'));
    check('news: one tap turns the card over', buy.classList.contains('flipped'));
    check('news: tapping does not open anything else', !P.d.querySelector('.thread-layer'));
    P.click(buy.querySelector('[data-q="no"]')); await P.sleep(500);
    check('news: refusing starts the ash', buy.classList.contains('burning'));
    check('look: while it burns, "touch to bring it back" is showing', cs(buy.querySelector('.undo-tip')).opacity === '1');
    P.tap(buy.querySelector('.fside-front')); await P.sleep(700);
    check('news: touching it brings it back whole', !buy.classList.contains('burning') && buy.isConnected && P.text('.item.flipper b') === 'شبنم پیشنهادت را پذیرفت');
    P.tap(buy.querySelector('.fside-front'));
    P.click(buy.querySelector('[data-q="yes"]')); await P.sleep(100);
    check('confirming gathers the card instead of burning it', buy.classList.contains('charging') && !buy.classList.contains('burning'));
    P.clock.offset += 5000; await P.sleep(1100);
    check('news: confirming, once settled, leaves the stream', !buy.isConnected);
    check('…and the person flies to Sol, which flares', P.d.getElementById('sol').classList.contains('absorb') || !!P.d.querySelector('.to-sol'));
    await P.toTalk();
    check('stair: Shabnam now waits on HER payment (a ghost row)', P.row('شبنم').classList.contains('ghost'), P.row('شبنم').textContent.replace(/\s+/g, ' ').trim());
    check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  }
  // --------------------------------------------- news → the conversation
  {
    const P = page(); await P.sleep(300);
    P.click(P.d.getElementById('badge')); await P.sleep(1000);
    const buy = P.d.querySelector('.item.flipper');
    P.tap(buy.querySelector('.fside-front'));
    P.click(buy.querySelector('[data-q="talk"]')); await P.sleep(2800);
    check('news → «گفتگو»: opens Shabnam\'s conversation', P.text('.th-who b') === 'شبنم');
    check('look: the request card is a real card, not loose text', P.w.getComputedStyle(P.d.querySelector('.req')).display === 'flex');
    check('…and the request card is inside it, with تأیید and رد', !!P.d.querySelector('.req [data-accept]') && !!P.d.querySelector('.req [data-reject]'), P.text('.req b'));
    check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  }
  // --------------------------------------------------------------- stair
  {
    const P = page(); await P.sleep(300);
    await P.toTalk();
    check('look: cards form only after people arrive, not mid-flight', P.midFlight === 0, `${P.midFlight} formed early`);
    const order = [...P.d.querySelectorAll('.row')].filter((r) => r.style.opacity !== '0')
      .sort((a, b) => parseFloat(b.style.transform.split(',')[1]) - parseFloat(a.style.transform.split(',')[1]))
      .map((r) => r.querySelector('b').textContent);
    check('stair: session first, then what waits on you, then unread', order.slice(0, 5).join('، ') === 'هومن، شبنم، آرش، نگار، کسری', order.slice(0, 6).join('، '));
    check('stair: waiting on you = solid & warm, waiting on them = ghost',
      P.row('شبنم').classList.contains('needs') && P.row('آرش').classList.contains('needs') && P.row('سوگند').classList.contains('ghost'));
    check('stair: no row carries the old page-frame name', !P.d.querySelector('.row .phone, .row .stage'));
    const chips = P.d.getElementById('chips');
    check('look: the filter is visible above the stair', !chips.hidden && P.w.getComputedStyle(chips).position === 'absolute');
    check('look: a ghost row looks different from a warm one',
      P.w.getComputedStyle(P.row('سوگند')).borderStyle !== P.w.getComputedStyle(P.row('آرش')).borderStyle || P.w.getComputedStyle(P.row('سوگند')).borderTopStyle === 'dashed');
    P.click(P.d.querySelector('#chips [data-filter="wait"]')); await P.sleep(100);
    const shown = [...P.d.querySelectorAll('.row')].filter((r) => r.style.opacity !== '0').map((r) => r.querySelector('b').textContent).sort();
    check('filter «در انتظار»: only requests', shown.join('، ') === ['آرش', 'سوگند', 'شبنم'].sort().join('، '), shown.join('، '));
    P.click(P.d.querySelector('#chips [data-filter="all"]')); await P.sleep(100);
    P.tap(P.row('سوگند')); await P.sleep(200);
    P.click(P.d.querySelector('[data-cancel]'));
    check('Soogand: «پس گرفتن» asks first', !!P.d.querySelector('[data-yes]'));
    P.click(P.d.querySelector('[data-yes]'));
    check('…then takes it back', P.text('.req b') === 'پس گرفتی.');
    P.click(P.d.querySelector('.th-back'));
    P.tap(P.row('آرش')); await P.sleep(200);
    check('Arash: pay button with Photons', /پرداختِ .* فوتون/.test(P.text('[data-pay]')), P.text('[data-pay]'));
    check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  }
  // -------------------------------------------- session: stop after block
  {
    const P = page(); await P.sleep(300);
    await P.toTalk();
    P.tap(P.row('هومن')); await P.sleep(300);
    check('session: bar shows block and time', /بلوکِ ۳ از ۴/.test(P.text('#sbar-t')), P.text('#sbar-t'));
    P.click(P.d.querySelector('[data-stop]')); await P.sleep(300);
    check('stop: time now counts to the end of THIS block', /سرِ همین بلوک تمام می‌شود/.test(P.text('#sbar-t')), P.text('#sbar-t'));
    P.clock.offset += 30000; await P.sleep(600);
    check('stop: the session actually ends at the block\'s end', !P.d.querySelector('.sbar') && !!P.d.querySelector('[data-band="3"] .band-foot'));
    const foot = P.text('[data-band="3"] .band-foot');
    check('ending names who ended it', foot.includes('به انتخابِ تو زودتر تمام شد'), foot.slice(0, 60));
    check('ending gives back the unused block, in Photons', foot.includes('۱ بلوکِ استفاده‌نشده — ۶۰ فوتون'));
    check('ending holds the rest for Hooman, in Photons', foot.includes('۱۸۰ فوتون برای هومن'));
    P.click(P.d.querySelector('[data-release]'));
    check('release asks first', !!P.d.querySelector('[data-yes]'));
    P.click(P.d.querySelector('[data-yes]')); await P.sleep(2500);
    check('release: done, and the thanks lands as a keepsake', P.text('.foot-done').includes('۱۸۰ فوتون به هومن منتقل شد') && !!P.d.querySelector('.react-chip.landed'));
    check('the thanks is only its sign — no caption', P.text('.react-chip') === '');
    check('no explanatory box on opening the conversation', !P.text('.toast').includes('ساعتِ جلسه'));
    check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  }
  // ------------------------------------ session: natural end + extension
  {
    const P = page(); await P.sleep(300);
    await P.toTalk();
    P.tap(P.row('هومن')); await P.sleep(300);
    P.clock.offset += 16000; await P.sleep(500);
    check('last block: «یک بلوکِ دیگر» appears, «stop» is gone', !!P.d.querySelector('[data-ext]') && !P.d.querySelector('[data-stop]'));
    P.click(P.d.querySelector('[data-ext]')); await P.sleep(300);
    check('extension waits for Hooman', P.text('.sbar-act button').includes('منتظرِ تأییدِ هومن'));
    await P.sleep(2600);
    check('Hooman agrees: five blocks, and stop is back for block 4', /از ۵/.test(P.text('#sbar-t')) && !!P.d.querySelector('[data-stop]'), P.text('#sbar-t'));
    P.clock.offset += 90000; await P.sleep(600);
    const foot = P.text('[data-band="3"] .band-foot');
    check('natural end: just "جلسه تمام شد"', foot.startsWith('جلسه تمام شد.'), foot.slice(0, 40));
    check('natural end: no refund line when every block was used', !foot.includes('برگشت'));
    check('natural end: 5 blocks = 300 Photons held', foot.includes('۳۰۰ فوتون برای هومن'));
    P.click(P.d.querySelector('[data-replay]')); await P.sleep(400);
    check('replay: the session runs again', !!P.d.querySelector('.sbar') && /از ۴/.test(P.text('#sbar-t')));
    check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
