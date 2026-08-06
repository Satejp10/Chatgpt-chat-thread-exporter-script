// Does a page that enforces Trusted Types break the exporter's UI?
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { findChromium } = require('./browser.js');

const REPO = path.join(__dirname, '..');
const FILE = 'ChatGPT Thread Exporter (Robust Auto-Scroll).user.js';
const HERE = __dirname;

// The pre-audit script, from git. `HEAD` is wrong here: once the audit commit
// lands, HEAD is the current version and the comparison silently compares the
// new script against itself and passes.
const BASELINE_REF = process.env.BASELINE_REF || '5405be1';
let oldSrc = null;
try {
  oldSrc = execSync(`git -C "${REPO}" show ${BASELINE_REF}:"${FILE}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
} catch (e) {
  console.log('(baseline ' + BASELINE_REF + ' unavailable; skipping the v3 comparison)');
}
const newSrc = fs.readFileSync(path.join(REPO, FILE), 'utf8');

// Same fixture, but with Trusted Types enforced the way chatgpt.com may.
const ttFixture = fs.readFileSync(path.join(HERE, 'fixture.html'), 'utf8')
  .replace('<meta charset="utf-8">',
    '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'">');
fs.writeFileSync(path.join(HERE, 'fixture-tt.html'), ttFixture);
const TT = 'file://' + path.join(HERE, 'fixture-tt.html');

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium() });

  const subjects = [];
  if (oldSrc) subjects.push(['baseline ' + BASELINE_REF, oldSrc]);
  subjects.push(['current', newSrc]);

  for (const [label, src] of subjects) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
    await page.goto(TT);
    await page.evaluate(src);
    // Either of these can throw for a script that violates Trusted Types; that
    // is the result being measured, not a reason to abort the run.
    try {
      await page.click('.export-chat-btn', { timeout: 5000 });
      await page.waitForTimeout(500);
    } catch (e) {
      errs.push(String(e).split('\n')[0]);
    }
    const modalUsable = await page.evaluate(() =>
      !!document.querySelector('.export-modal-overlay') &&
      document.querySelectorAll('.export-modal-overlay button').length >= 2);
    console.log(label + ' under Trusted Types:');
    console.log('   export modal usable : ' + (modalUsable ? 'yes' : 'NO'));
    console.log('   page errors         : ' + (errs.length ? errs.join(' | ') : 'none'));
    await ctx.close();
  }

  // Screenshot of the rail, for the record.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(HERE, 'out-current.html'));
  await page.evaluate(() => {
    try { sessionStorage.removeItem('cge-rail-hidden'); } catch (e) {}
    document.getElementById('m-0040').scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(600);
  await page.hover('#rail ol li a[href="#m-0044"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(HERE, 'rail.png') });
  console.log('\nscreenshot: rail.png');
  await ctx.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
