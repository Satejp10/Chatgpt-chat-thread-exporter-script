const M = require('./harness.js');

const N = 300;
const msgs = [];
for (let i = 0; i < N; i++) {
  const user = i % 2 === 0;
  msgs.push({
    id: 'x' + i,
    role: user ? 'user' : 'assistant',
    text: user
      ? 'Can you explain how the ' + 'widget subsystem '.repeat(3) + 'handles retries, and what happens when the backend returns a 429? Message number ' + i + '.'
      : 'Here is the short version. See [the docs](https://example.com/docs/' + i + ') for detail.\n\n' +
        'The retry path is bounded by a token bucket. ' + 'Each attempt is logged and backed off exponentially. '.repeat(12) + '\n\n' +
        '```js\nasync function retry(fn, tries = 5) {\n  for (let i = 0; i < tries; i++) {\n    try { return await fn(); } catch (e) { await wait(2 ** i * 100); }\n  }\n}\n```\n\n' +
        'That covers the common case. ' + 'Edge cases are handled upstream. '.repeat(8)
  });
}

const stats = { count: N, emptySkipped: 0, complete: true, reasons: [], durationMs: 0, capturedAt: new Date() };
const meta = { title: 'Widget subsystem retry semantics', url: 'https://chatgpt.com/c/abc-123' };

const t0 = process.hrtime.bigint();
const html = M.renderHtml(msgs, stats, meta);
const t1 = process.hrtime.bigint();
const md = M.renderMarkdown(msgs, stats, meta);
const t2 = process.hrtime.bigint();

const bytes = s => Buffer.byteLength(s, 'utf8');
const kb = n => (n / 1024).toFixed(1) + ' KB';

// --- isolate the rail's contribution -------------------------------------
const navStart = html.indexOf('<button id="rail-toggle"');
const navEnd = html.indexOf('</nav>') + '</nav>\n'.length;
const navMarkup = html.slice(navStart, navEnd);

const cssRailStart = M.EXPORT_CSS.indexOf('/* Navigation:');
const cssRailEnd = M.EXPORT_CSS.indexOf('@media (prefers-reduced-motion');
const railCss = M.EXPORT_CSS.slice(cssRailStart, cssRailEnd);

const jsRailStart = M.EXPORT_JS.indexOf('  var rail = document.getElementById("rail");');
const railJs = M.EXPORT_JS.slice(jsRailStart);

const idBytes = (html.match(/ id="m-\d{4}"/g) || []).reduce((a, s) => a + bytes(s), 0);
const railTotal = bytes(navMarkup) + bytes(railCss) + bytes(railJs) + idBytes;
const userTurns = msgs.filter(m => m.role === 'user').length;

console.log('=== Export size, ' + N + ' messages (' + userTurns + ' user turns) ===');
console.log('HTML export total          ' + kb(bytes(html)));
console.log('Markdown export total      ' + kb(bytes(md)));
console.log('');
console.log('=== Nav rail cost (measured, not estimated) ===');
console.log('rail CSS (fixed)           ' + bytes(railCss) + ' B');
console.log('rail JS  (fixed)           ' + bytes(railJs) + ' B');
console.log('nav markup (' + userTurns + ' links)    ' + kb(bytes(navMarkup)));
console.log('id attrs on ' + N + ' messages  ' + idBytes + ' B');
console.log('--------------------------------------------');
console.log('rail total                 ' + kb(railTotal));
console.log('as % of HTML export        ' + ((railTotal / bytes(html)) * 100).toFixed(1) + '%');
console.log('export size without rail   ' + kb(bytes(html) - railTotal));
console.log('per user turn              ' + Math.round((bytes(navMarkup) - 60) / userTurns) + ' B');
console.log('');
console.log('=== Render time ===');
console.log('renderHtml  ' + (Number(t1 - t0) / 1e6).toFixed(1) + ' ms');
console.log('renderMd    ' + (Number(t2 - t1) / 1e6).toFixed(1) + ' ms');
console.log('');
console.log('=== Script file ===');
console.log('userscript  ' + kb(bytes(M.__raw)) + '  (was 12.7 KB at v3.0)');
