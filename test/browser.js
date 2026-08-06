// Locates a Chromium build for the browser-based tests.
// Set CHROMIUM_PATH to override.
const fs = require('fs');
const path = require('path');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch (e) { continue; }
    for (const dir of entries.filter(d => d.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(root, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }

  const common = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const p of common) if (fs.existsSync(p)) return p;

  throw new Error('No Chromium found. Set CHROMIUM_PATH to a Chrome/Chromium binary.');
}

module.exports = { findChromium };
