// Loads the userscript's pure logic without a DOM, so the escaping, filename
// and rendering code can be unit-tested directly.
//
// The userscript is one IIFE with no exports. Rather than duplicating the code,
// this slices out the IIFE body up to the bootstrap line (the only part that
// needs a live DOM) and re-evaluates it with a return statement appended.
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
  'clockSuffix', 'loadPrefs', 'savePrefs', 'defaultPrefs', 'GENERIC_TITLE', 'PREF_KEY'
];

const factory = new Function(body + '\n    return { ' + EXPORTS.join(', ') + ' };\n');
module.exports = factory();
module.exports.__raw = raw;
module.exports.__src = SRC;
