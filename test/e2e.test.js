const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { findChromium } = require('./browser.js');

const REPO = path.join(__dirname, '..');
const FILE = 'ChatGPT Thread Exporter (Robust Auto-Scroll).user.js';
const HERE = __dirname;
const FIXTURE = 'file://' + path.join(HERE, 'fixture.html');

// Optional regression baseline: the pre-audit v3.0 script. Used only to show
// the capture fix is real. Set BASELINE_REF to another commit, or leave it
// unresolvable and the comparison is skipped.
const BASELINE_REF = process.env.BASELINE_REF || '5405be1';
let oldSrc = null;
try {
  oldSrc = execSync(`git -C "${REPO}" show ${BASELINE_REF}:"${FILE}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
} catch (e) {
  console.log('(baseline ' + BASELINE_REF + ' unavailable; skipping the v3 comparison)');
}
const newSrc = fs.readFileSync(path.join(REPO, FILE), 'utf8');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '\n          ' + extra));
  if (!cond) fails++;
};

async function capture(browser, src, label) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', r => { if (!r.url().startsWith('file://')) requests.push(r.url()); });
  page.on('dialog', d => d.dismiss());
  await page.goto(FIXTURE);
  await page.evaluate(src);
  await page.click('.export-chat-btn');
  const btn = page.locator('button.html-btn, button:has-text("Download HTML")').first();
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await btn.click();
  const download = await dl;
  const out = path.join(HERE, 'out-' + label + '.html');
  await download.saveAs(out);
  const html = fs.readFileSync(out, 'utf8');
  await ctx.close();
  return {
    html,
    filename: download.suggestedFilename(),
    count: (html.match(/class="message /g) || []).length,
    requests
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium() });

  console.log('\n=== Capture completeness on a 120-message lazy-loading thread ===');
  let before = null;
  if (oldSrc) {
    before = await capture(browser, oldSrc, 'baseline');
    console.log('  baseline (v3.0) captured ' + before.count + ' / 120 messages  (file: ' + before.filename + ')');
  }
  const after = await capture(browser, newSrc, 'current');
  console.log('  current captured ' + after.count + ' / 120 messages  (file: ' + after.filename + ')');
  ok('captures the whole thread', after.count === 120, 'got ' + after.count);
  if (before) {
    ok('improves on the pre-audit baseline', after.count > before.count, 'baseline=' + before.count + ' current=' + after.count);
    ok('baseline made no network requests', before.requests.length === 0, before.requests.join(', '));
  }
  ok('flags the capture complete', after.html.includes('>complete<'), '');
  ok('filename carries title + date', /Fake lazy-loading thread-\d{4}-\d{2}-\d{2}\.html$/.test(after.filename), after.filename);
  ok('export run made no network requests', after.requests.length === 0, after.requests.join(', '));
  ok('links preserved in export', after.html.includes('<a href="https://example.com/ref/1"'), '');
  ok('code fences preserved in export', after.html.includes('<pre><code class="lang-js">'), '');

  // ------------------------------------------------------------------ export
  console.log('\n=== Exported file behaviour (opened from disk) ===');
  const out = 'file://' + path.join(HERE, 'out-current.html');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const netHits = [];
  const dialogs = [];
  const errors = [];
  page.on('request', r => { if (r.url() !== out) netHits.push(r.url()); });
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(out);
  await page.waitForTimeout(400);

  ok('no JS errors in export', errors.length === 0, errors.join('\n'));
  ok('no dialogs fired (no XSS execution)', dialogs.length === 0, dialogs.join(', '));
  ok('export makes zero network requests', netHits.length === 0, netHits.join(', '));

  ok('html.js applied', await page.evaluate(() => document.documentElement.classList.contains('js')));
  ok('rail is fixed-position in JS mode',
    await page.evaluate(() => getComputedStyle(document.getElementById('rail')).position === 'fixed'));
  const ticks = await page.locator('#rail ol li').count();
  ok('one rail tick per user message', ticks === 60, 'got ' + ticks);

  // active tick tracking. Jump instantly: the export sets scroll-behavior:
  // smooth, and a smooth scroll still in flight would race the assertion.
  const activeHref = () => page.evaluate(() => {
    const li = document.querySelector('#rail li.active');
    return li ? li.querySelector('a').getAttribute('href') : null;
  });
  await page.evaluate(() => document.getElementById('m-0080').scrollIntoView({ behavior: 'instant', block: 'start' }));
  await page.waitForTimeout(800);
  const active1 = await activeHref();
  ok('active tick follows scroll position', active1 === '#m-0080', 'active=' + active1);

  // keyboard nav, expectations derived from rail order rather than hardcoded
  const neighbour = (href, delta) => page.evaluate(([h, d]) => {
    const hrefs = [].map.call(document.querySelectorAll('#rail ol a'), a => a.getAttribute('href'));
    return hrefs[hrefs.indexOf(h) + d];
  }, [href, delta]);

  await page.keyboard.press('j');
  await page.waitForTimeout(900);
  const active2 = await activeHref();
  ok('j advances to the next prompt', active2 === await neighbour(active1, 1), 'active=' + active2);
  await page.keyboard.press('k');
  await page.waitForTimeout(900);
  const active3 = await activeHref();
  ok('k returns to the previous prompt', active3 === active1, 'active=' + active3);

  // click to jump
  await page.locator('#rail li a[href="#m-0010"]').click({ force: true });
  await page.waitForTimeout(700);
  ok('clicking a tick jumps to that message',
    await page.evaluate(() => {
      const r = document.getElementById('m-0010').getBoundingClientRect();
      return r.top > -50 && r.top < window.innerHeight;
    }));

  // hover tooltip must escape the rail's scroll clipping
  await page.hover('#rail ol li a[href="#m-0080"]');
  await page.waitForTimeout(350);
  const tip = await page.evaluate(() => {
    const t = document.getElementById('rail-tip');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return {
      text: t.textContent, opacity: getComputedStyle(t).opacity,
      left: r.left, right: r.right, width: r.width, vw: window.innerWidth
    };
  });
  ok('tooltip shows the prompt preview',
    tip && tip.opacity === '1' && tip.text.includes('Message number 80'), JSON.stringify(tip));
  ok('tooltip is not clipped by the rail',
    tip && tip.width > 120 && tip.right < tip.vw - 30, JSON.stringify(tip));

  // toggle + persistence
  await page.click('#rail-toggle');
  await page.waitForTimeout(150);
  ok('toggle hides the rail',
    await page.evaluate(() => getComputedStyle(document.querySelector('#rail ol')).display === 'none'));
  ok('toggle choice persisted for the session',
    await page.evaluate(() => sessionStorage.getItem('cge-rail-hidden') === '1'));
  await page.reload();
  await page.waitForTimeout(300);
  ok('rail stays hidden after reload',
    await page.evaluate(() => getComputedStyle(document.querySelector('#rail ol')).display === 'none'));
  await ctx.close();

  // ------------------------------------------------------------- no-JS mode
  console.log('\n=== Exported file with JavaScript disabled ===');
  const njCtx = await browser.newContext({ javaScriptEnabled: false });
  const njPage = await njCtx.newPage();
  await njPage.goto(out);
  ok('nav list is visible without JS',
    await njPage.evaluate(() => {
      const ol = document.querySelector('#rail ol');
      return getComputedStyle(ol).display !== 'none' && ol.getBoundingClientRect().height > 0;
    }));
  ok('nav is in normal flow, not a fixed rail',
    await njPage.evaluate(() => getComputedStyle(document.getElementById('rail')).position === 'static'));
  ok('nav links are real anchors with previews',
    await njPage.evaluate(() => {
      const a = document.querySelector('#rail ol li a');
      return a.getAttribute('href') === '#m-0000' && a.textContent.trim().length > 5;
    }));
  ok('message text is readable without JS',
    await njPage.evaluate(() => document.getElementById('m-0000').innerText.includes('Message number 0')));
  await njCtx.close();

  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILURES' : 'all checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
