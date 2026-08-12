// Loads the userscript's pure logic without a DOM, so the escaping, filename,
// timestamp and rendering code can be unit-tested directly.
//
// The userscript is one IIFE with no exports. Rather than duplicating the code,
// this slices out the IIFE body up to the bootstrap line (the only part that
// needs a live DOM) and re-evaluates it with a return statement appended.
//
// The slice is not inert. v5.0 introduced site adapters, and the body now runs
// `const SITE = pickSite()` at top level, which reads `location.hostname`. In
// Node that threw at require() time, so the whole unit suite died on load and
// stayed dead through four releases. The fix is a minimal environment stub,
// installed before evaluation and left in place afterwards because functions
// like conversationTitle() read `document` when they are called, not when they
// are defined.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'ChatGPT Thread Exporter (Robust Auto-Scroll).user.js');
const raw = fs.readFileSync(SRC, 'utf8');

const start = raw.indexOf("(function () {\n    'use strict';");
if (start < 0) throw new Error('IIFE header not found: has the file been restructured?');
const cut = raw.indexOf('    new MutationObserver(schedule).observe');
if (cut < 0) throw new Error('bootstrap line not found: has the file been restructured?');

const body = raw.slice(raw.indexOf('\n', start) + 1, cut);

const EXPORTS = [
  'escapeHtml', 'isSafeUrl', 'stripControl', 'sanitizeFilename', 'mdToSafeHtml',
  'makeFence', 'railLabel', 'roleClass', 'roleLabel', 'tidyMd', 'nodeToMd',
  'renderMarkdown', 'renderHtml', 'EXPORT_CSS', 'EXPORT_JS', 'conversationTitle', 'isoDate',
  'clockSuffix', 'loadPrefs', 'savePrefs', 'defaultPrefs', 'GENERIC_TITLE', 'PREF_KEY',
  // Timestamp recognition. Pure functions, and the source of the only two bugs
  // in this project that shipped and survived multiple releases (v5.5, v5.6).
  'flatten', 'looksLikeTimeLabel', 'MAX_LABEL_LEN',
  // Site adapter, so a test can assert which site the slice resolved to.
  'SITE'
];

// The smallest environment the top-level body needs. Deliberately not a DOM
// implementation: anything that genuinely needs one belongs in e2e.test.js
// against a real browser, not here.
function installEnv(hostname, pathname) {
  const emptyList = [];
  global.location = {
    hostname: hostname,
    pathname: pathname || '/',
    href: 'https://' + hostname + (pathname || '/')
  };
  global.document = {
    title: '',
    hidden: false,
    querySelectorAll: () => emptyList,
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => { throw new Error('createElement: the harness has no DOM; use e2e.test.js'); },
    body: null,
    documentElement: null
  };
  global.window = global.window || global;
}

// Evaluates the userscript body as if it had been loaded on `hostname`.
// Each call returns an independent module object, so a test can hold the
// ChatGPT and Claude adapters side by side.
function load(hostname, pathname) {
  installEnv(hostname || 'chatgpt.com', pathname);
  const factory = new Function(body + '\n    return { ' + EXPORTS.join(', ') + ' };\n');
  const mod = factory();
  mod.__raw = raw;
  mod.__src = SRC;
  return mod;
}

module.exports = load('chatgpt.com');
module.exports.load = load;
module.exports.installEnv = installEnv;
