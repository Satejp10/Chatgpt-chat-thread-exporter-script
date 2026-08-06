// ==UserScript==
// @name         ChatGPT Thread Exporter (Robust Auto-Scroll)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Exports full ChatGPT threads (defeats virtualization/lazy loading) to Markdown/HTML. Preserves links and code blocks, reports capture completeness, and makes zero network requests.
// @author       You
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

// ---------------------------------------------------------------------------
// Design constraints (see .claude/context/LOG.md):
//   * No network requests, ever. No fetch/XHR/beacon/WebSocket/@connect.
//   * No eval, no Function(), no remote code, no auto-update.
//   * No persistence of conversation content. Nothing is stored outside the
//     download the user explicitly asks for.
//   * No build step, no dependencies, single file.
//   * Never assign to innerHTML: the page may enforce Trusted Types, and the
//     export must be safe to open from disk.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    const MSG_SELECTOR = '[data-message-author-role]';
    const STALL_PASSES = 3;      // consecutive zero-yield passes before we call it done
    const MAX_DOWN_STEPS = 4000; // hard ceiling; hitting it means "possibly truncated"
    const MAX_TOP_SEEKS = 400;   // hard ceiling on the lazy-prepend seek loop
    const STEP_SETTLE_MS = 220;
    const TOP_SETTLE_MS = 450;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // -----------------------------------------------------------------------
    // Escaping and sanitising
    // -----------------------------------------------------------------------

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Only http(s) and mailto survive into an href. Everything else (javascript:,
    // data:, vbscript:, file:) is rendered as inert text instead of a link.
    const SAFE_URL_RE = /^(?:https?:\/\/|mailto:)[^\s"'<>]+$/i;

    function isSafeUrl(href) {
        const s = String(href).replace(/[\u0000-\u0020]/g, '');
        return SAFE_URL_RE.test(s);
    }

    // Strip control characters that would corrupt the output file or collide
    // with our internal placeholders. Tab and newline are kept.
    function stripControl(s) {
        return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    }

    const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

    function sanitizeFilename(name, fallback) {
        let s = String(name == null ? '' : name)
            .replace(/[\u0000-\u001F\u007F]/g, ' ')  // control chars, incl. newlines and NUL
            .replace(/[\/\\:*?"<>|]/g, '-')          // path separators + Windows-illegal
            .replace(/\.{2,}/g, '.')                 // no "..", so no traversal fragments
            .replace(/\s+/g, ' ')
            .replace(/-{2,}/g, '-')
            .replace(/^[\s.\-]+/, '')                // no leading dot: no hidden files
            .replace(/[\s.\-]+$/, '')                // no trailing dot: Windows strips it
            .slice(0, 80)
            .replace(/[\s.\-]+$/, '');
        if (!s || WINDOWS_RESERVED.test(s)) s = fallback;
        return s;
    }

    function conversationTitle() {
        const raw = (document.title || '').replace(/\s*[|\-–—]\s*ChatGPT\s*$/i, '').trim();
        if (!raw || /^chatgpt$/i.test(raw)) return 'ChatGPT export';
        return raw;
    }

    function isoDate(d) {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    const ROLE_LABELS = { user: 'User', assistant: 'Assistant', system: 'System', tool: 'Tool' };

    function roleLabel(role) {
        if (ROLE_LABELS[role]) return ROLE_LABELS[role];
        const clean = String(role || 'unknown').replace(/[^a-z0-9 _-]/gi, '');
        return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Unknown';
    }

    function roleClass(role) {
        const clean = String(role || '').toLowerCase().replace(/[^a-z-]/g, '');
        return clean || 'unknown';
    }

    // -----------------------------------------------------------------------
    // Content extraction
    //
    // The previous version used innerText, which is layout-aware: it silently
    // returned nothing for collapsed/hidden content, and it discarded every
    // link target and code fence. This walker reads the tree instead and emits
    // Markdown, so URLs and code survive into the archive.
    // -----------------------------------------------------------------------

    const SKIP_TAGS = new Set([
        'BUTTON', 'SVG', 'IMG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME',
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'OPTION'
    ]);

    function detectLang(el) {
        const cls = el.getAttribute && el.getAttribute('class') || '';
        const m = cls.match(/language-([a-zA-Z0-9+#._-]+)/);
        return m ? m[1] : '';
    }

    // A fence long enough that nothing inside the block can close it early.
    function makeFence(body) {
        let n = 3;
        const runs = body.match(/^`{3,}/gm);
        if (runs) {
            for (const r of runs) if (r.length >= n) n = r.length + 1;
        }
        return '`'.repeat(n);
    }

    function codeTextOf(pre) {
        const code = pre.querySelector('code');
        const target = code || pre;
        const clone = target.cloneNode(true);
        clone.querySelectorAll('button, svg, .custom-copy-btn').forEach(el => el.remove());
        return clone.textContent.replace(/\s+$/, '');
    }

    function childrenToMd(node) {
        let out = '';
        for (const child of node.childNodes) out += nodeToMd(child);
        return out;
    }

    function nodeToMd(node) {
        if (node.nodeType === 3) return node.nodeValue;              // text
        if (node.nodeType !== 1) return '';                          // comments etc.

        const tag = node.tagName;
        if (SKIP_TAGS.has(tag)) return '';
        if (node.classList && node.classList.contains('custom-copy-btn')) return '';
        if (node.getAttribute && node.getAttribute('role') === 'button') return '';

        switch (tag) {
            case 'PRE': {
                const body = codeTextOf(node);
                if (!body) return '';
                const fence = makeFence(body);
                return '\n\n' + fence + detectLang(node.querySelector('code') || node) + '\n' + body + '\n' + fence + '\n\n';
            }
            case 'CODE': {
                const t = node.textContent;
                if (!t) return '';
                const ticks = '`'.repeat(Math.max(1, (t.match(/`+/g) || ['']).reduce((a, b) => Math.max(a, b.length), 0) + 1));
                return ticks + t + ticks;
            }
            case 'A': {
                const text = childrenToMd(node).trim();
                const href = node.getAttribute('href') || '';
                if (!href || !isSafeUrl(href)) return text;
                if (!text) return href;
                return '[' + text.replace(/[\[\]]/g, '') + '](' + href + ')';
            }
            case 'STRONG':
            case 'B': {
                const t = childrenToMd(node);
                return t.trim() ? '**' + t.trim() + '**' : t;
            }
            case 'EM':
            case 'I': {
                const t = childrenToMd(node);
                return t.trim() ? '*' + t.trim() + '*' : t;
            }
            case 'DEL':
            case 'S': {
                const t = childrenToMd(node);
                return t.trim() ? '~~' + t.trim() + '~~' : t;
            }
            case 'BR':
                return '\n';
            case 'HR':
                return '\n\n---\n\n';
            case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
                const t = childrenToMd(node).trim();
                return t ? '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + t + '\n\n' : '';
            }
            case 'BLOCKQUOTE': {
                const inner = tidyMd(childrenToMd(node));
                if (!inner) return '';
                return '\n\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
            }
            case 'UL':
            case 'OL': {
                const start = Number(node.getAttribute('start') || '1') || 1;
                const lines = [];
                let i = 0;
                for (const li of node.children) {
                    if (li.tagName !== 'LI') continue;
                    const marker = tag === 'OL' ? (start + i) + '.' : '-';
                    const body = tidyMd(childrenToMd(li));
                    if (!body) { i++; continue; }
                    const indent = ' '.repeat(marker.length + 1);
                    lines.push(marker + ' ' + body.split('\n').map((l, n) => (n === 0 ? l : indent + l)).join('\n'));
                    i++;
                }
                return lines.length ? '\n\n' + lines.join('\n') + '\n\n' : '';
            }
            case 'TABLE': {
                const rows = Array.from(node.querySelectorAll('tr'));
                if (!rows.length) return childrenToMd(node);
                const cells = tr => Array.from(tr.children)
                    .map(td => tidyMd(childrenToMd(td)).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
                const head = cells(rows[0]);
                if (!head.length) return childrenToMd(node);
                const lines = [
                    '| ' + head.join(' | ') + ' |',
                    '| ' + head.map(() => '---').join(' | ') + ' |'
                ];
                for (const tr of rows.slice(1)) {
                    const c = cells(tr);
                    if (c.length) lines.push('| ' + c.join(' | ') + ' |');
                }
                return '\n\n' + lines.join('\n') + '\n\n';
            }
            case 'P':
            case 'DIV':
            case 'SECTION':
            case 'ARTICLE':
                return '\n\n' + childrenToMd(node) + '\n\n';
            default:
                return childrenToMd(node);
        }
    }

    function tidyMd(s) {
        return stripControl(s)
            .replace(/\u00A0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function extractContent(element) {
        try {
            const out = tidyMd(nodeToMd(element));
            if (out) return out;
        } catch (err) {
            // fall through to the plain-text path below
        }
        // Fallback: the old behaviour. Lossy, but better than dropping the turn.
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.custom-copy-btn, button, svg, img').forEach(el => el.remove());
        return tidyMd(clone.textContent || '');
    }

    // -----------------------------------------------------------------------
    // Downloads
    // -----------------------------------------------------------------------

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking synchronously after click() races the download in some
        // browsers. Defer it; the URL is local and short-lived either way.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // -----------------------------------------------------------------------
    // Scroll control
    // -----------------------------------------------------------------------

    // Walk up from a real message instead of scanning every element on the
    // page. The old full-document scan called getComputedStyle thousands of
    // times and could pick the conversation sidebar over the thread.
    function findScroller() {
        const anchor = document.querySelector(MSG_SELECTOR);
        let el = anchor ? anchor.parentElement : null;
        while (el && el !== document.body && el !== document.documentElement) {
            const s = window.getComputedStyle(el);
            const oy = s.overflowY;
            const scrollable = oy === 'auto' || oy === 'scroll' || s.overflow === 'auto' || s.overflow === 'scroll';
            if (scrollable && el.scrollHeight > el.clientHeight + 40) return el;
            el = el.parentElement;
        }
        return null; // window scrolling
    }

    function makeScrollCtl(scroller) {
        const isWin = !scroller;
        return {
            isWin,
            top() { return isWin ? (window.scrollY || document.documentElement.scrollTop || 0) : scroller.scrollTop; },
            setTop(v) { if (isWin) window.scrollTo(0, v); else scroller.scrollTop = v; },
            by(d) { if (isWin) window.scrollBy(0, d); else scroller.scrollTop = scroller.scrollTop + d; },
            height() { return isWin ? document.documentElement.scrollHeight : scroller.scrollHeight; },
            view() { return isWin ? window.innerHeight : scroller.clientHeight; },
            atBottom() { return this.top() + this.view() >= this.height() - 4; }
        };
    }

    // -----------------------------------------------------------------------
    // Capture
    // -----------------------------------------------------------------------

    function makeLoader() {
        const box = document.createElement('div');
        box.id = 'chat-export-loader';
        box.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);' +
            'background:rgba(30,30,30,0.95); color:#fff; padding:20px 30px; border-radius:8px;' +
            'z-index:2147483000; font-size:15px; font-family:sans-serif; text-align:center;' +
            'min-width:280px; box-shadow:0 4px 12px rgba(0,0,0,0.3); white-space:pre-line;';
        box.textContent = 'Loading conversation...';
        document.body.appendChild(box);
        return box;
    }

    async function captureMessages(loader) {
        const messages = [];
        const seen = new Set();
        const ctl = makeScrollCtl(findScroller());
        const startedAt = Date.now();
        const originalTop = ctl.top();

        let emptySkipped = 0;

        const say = text => { if (loader) loader.textContent = text; };

        const collect = () => {
            let added = 0;
            const nodes = document.querySelectorAll(MSG_SELECTOR);
            for (let i = 0; i < nodes.length; i++) {
                const msg = nodes[i];
                const role = msg.getAttribute('data-message-author-role') || 'unknown';
                // Prefer the real message id. The old positional fallback keyed
                // on the first 50 characters of text, which collapsed genuinely
                // distinct short messages ("ok", "continue") into one.
                const id = msg.getAttribute('data-message-id') || ('pos:' + role + ':' + domPath(msg));
                if (seen.has(id)) continue;
                seen.add(id);
                const text = extractContent(msg);
                if (!text) { emptySkipped++; continue; }
                messages.push({ id, role, text });
                added++;
            }
            return added;
        };

        // -- Phase A: force the full history to load -------------------------
        // Jumping to scrollTop 0 once only reaches the top of what is currently
        // mounted. ChatGPT then fetches older turns and prepends them, pushing
        // content back down. Re-assert the top until nothing more arrives.
        let topStable = 0;
        let lastHeight = -1;
        let lastCount = -1;
        let topSeeks = 0;
        while (topStable < STALL_PASSES && topSeeks < MAX_TOP_SEEKS) {
            ctl.setTop(0);
            await sleep(TOP_SETTLE_MS);
            const h = ctl.height();
            const n = document.querySelectorAll(MSG_SELECTOR).length;
            if (h === lastHeight && n === lastCount) topStable++; else topStable = 0;
            lastHeight = h;
            lastCount = n;
            topSeeks++;
            say('Loading older messages...\n' + n + ' turns mounted');
        }
        const topConverged = topSeeks < MAX_TOP_SEEKS;

        // -- Phase B: descend and collect ------------------------------------
        collect();
        const step = Math.max(200, ctl.view() * 0.8);
        let stall = 0;
        let steps = 0;
        let reachedBottom = ctl.atBottom();

        while (stall < STALL_PASSES && steps < MAX_DOWN_STEPS) {
            ctl.by(step);
            await sleep(STEP_SETTLE_MS);
            const added = collect();
            steps++;

            const bottom = ctl.atBottom();
            if (bottom) reachedBottom = true;

            // The old loop exited the moment one scrollBy failed to move the
            // container, which is exactly what happens while older turns are
            // loading. Only a run of genuinely empty passes at the bottom ends
            // the capture now.
            if (added === 0 && bottom) stall++; else stall = 0;

            const denom = Math.max(1, ctl.height() - ctl.view());
            const pct = Math.max(0, Math.min(100, Math.round((ctl.top() / denom) * 100)));
            say('Capturing conversation...\n' + pct + '%\n' + messages.length + ' messages found');
        }

        ctl.setTop(originalTop);

        const hitCeiling = steps >= MAX_DOWN_STEPS;
        const complete = topConverged && reachedBottom && !hitCeiling;
        const reasons = [];
        if (!topConverged) reasons.push('the top of the thread was never reached');
        if (!reachedBottom) reasons.push('the bottom of the thread was never reached');
        if (hitCeiling) reasons.push('the scroll-step ceiling was hit');
        if (emptySkipped) reasons.push(emptySkipped + ' turn(s) yielded no text');

        return {
            messages,
            stats: {
                count: messages.length,
                emptySkipped,
                complete,
                reasons,
                durationMs: Date.now() - startedAt,
                capturedAt: new Date()
            }
        };
    }

    // Stable-ish positional key for messages with no data-message-id.
    function domPath(el) {
        const parts = [];
        let node = el;
        let depth = 0;
        while (node && node.parentElement && depth < 12) {
            parts.push(Array.prototype.indexOf.call(node.parentElement.children, node));
            node = node.parentElement;
            depth++;
        }
        return parts.join('.');
    }

    // -----------------------------------------------------------------------
    // Markdown renderer
    // -----------------------------------------------------------------------

    function renderMarkdown(messages, stats, meta) {
        const lines = [];
        lines.push('---');
        lines.push('title: ' + JSON.stringify(meta.title));
        lines.push('source: ' + JSON.stringify(meta.url));
        lines.push('exported: ' + stats.capturedAt.toISOString());
        lines.push('messages: ' + stats.count);
        lines.push('capture: ' + (stats.complete ? 'complete' : 'possibly-truncated'));
        if (!stats.complete && stats.reasons.length) {
            lines.push('capture_notes: ' + JSON.stringify(stats.reasons.join('; ')));
        }
        lines.push('generator: ChatGPT Thread Exporter');
        lines.push('---');
        lines.push('');
        lines.push('# ' + meta.title.replace(/\n/g, ' '));
        lines.push('');
        if (!stats.complete) {
            lines.push('> **Capture may be incomplete.** ' + stats.reasons.join('; ') + '.');
            lines.push('');
        }

        messages.forEach((msg, i) => {
            const n = i + 1;
            // The index in both the marker and the heading makes turn boundaries
            // verifiable: a parser can check they run 1..N against the `messages`
            // count above. Message text can imitate a heading, but it cannot
            // produce a correctly numbered monotonic sequence.
            lines.push('<!-- msg:' + n + ' role:' + roleClass(msg.role) + ' -->');
            lines.push('## [' + n + '] ' + roleLabel(msg.role));
            lines.push('');
            lines.push(msg.text);
            lines.push('');
        });

        return lines.join('\n');
    }

    // -----------------------------------------------------------------------
    // HTML renderer
    // -----------------------------------------------------------------------

    // Turn the extracted Markdown into a small, safe subset of HTML. Everything
    // is HTML-escaped *first*, so no markup from message content can survive;
    // we then re-introduce only tags we generate ourselves, and the single
    // content-derived attribute (href) is scheme-validated and already escaped.
    function mdToSafeHtml(raw) {
        const blocks = [];
        let s = escapeHtml(raw);

        s = s.replace(/```([a-zA-Z0-9+#._-]*)\n([\s\S]*?)```/g, function (m, lang, code) {
            const cls = lang ? ' class="lang-' + escapeHtml(lang) + '"' : '';
            blocks.push('<pre><code' + cls + '>' + code.replace(/\n$/, '') + '</code></pre>');
            return '\u0001B' + (blocks.length - 1) + '\u0001';
        });

        s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
            return isSafeUrl(url.replace(/&amp;/g, '&'))
                ? '<a href="' + url + '" rel="noopener noreferrer">' + text + '</a>'
                : m;
        });

        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

        return s.replace(/\u0001B(\d+)\u0001/g, (m, i) => blocks[Number(i)]);
    }

    function railLabel(text) {
        const flat = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
        return flat.length > 72 ? flat.slice(0, 71) + '…' : (flat || 'Untitled prompt');
    }

    const EXPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0; padding: 24px 16px 64px; background: #f9f9f9; color: #24292f; line-height: 1.6; }
.wrap { max-width: 820px; margin: 0 auto; }
header.export-head { margin-bottom: 24px; }
header.export-head h1 { font-size: 1.5em; margin: 0 0 6px; word-wrap: break-word; }
.meta { color: #57606a; font-size: 0.85em; margin: 0 0 4px; }
.meta a { color: #0969da; }
.flag-ok { color: #1a7f37; font-weight: 600; }
.flag-warn { color: #9a6700; font-weight: 600; }
.warn-box { border: 1px solid #d4a72c; background: #fff8c5; color: #633c01;
  border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 0.9em; }
.message { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px 18px;
  margin-bottom: 20px; position: relative; box-shadow: 0 2px 4px rgba(0,0,0,0.05); scroll-margin-top: 16px; }
.message.user { background: #eef2ff; border-color: #d1d8ff; }
.message:target { outline: 2px solid #10a37f; outline-offset: 2px; }
.message h2 { margin: 0; font-size: 0.95em; color: #57606a; font-weight: 600; letter-spacing: 0.02em; }
.content { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 10px; }
.content a { color: #0969da; }
.content code { background: rgba(175,184,193,0.2); padding: 0.15em 0.35em; border-radius: 4px;
  font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.content pre { white-space: pre; overflow-x: auto; background: #1f2328; color: #e6edf3;
  padding: 12px 14px; border-radius: 6px; margin: 12px 0; }
.content pre code { background: none; padding: 0; color: inherit; font-size: 0.88em; }
.copy-btn { position: absolute; top: 12px; right: 12px; padding: 4px 10px; background: #10a37f;
  color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
.copy-btn:hover { background: #0d8a6a; }

/* Navigation: a plain anchor list by default, so the export stays usable with
   JavaScript disabled. The inline script sets html.js, which turns the same
   markup into the fixed rail. No second copy of the list is emitted. */
#rail { max-width: 820px; margin: 0 auto 24px; padding: 12px 16px; background: #fff;
  border: 1px solid #e0e0e0; border-radius: 8px; }
#rail h2 { font-size: 0.9em; margin: 0 0 8px; color: #57606a; }
#rail ol { margin: 0; padding-left: 1.4em; font-size: 0.9em; }
#rail li { margin: 2px 0; }
#rail a { color: #0969da; text-decoration: none; }
#rail a:hover { text-decoration: underline; }
#rail-toggle { display: none; }

html.js #rail { position: fixed; top: 0; right: 0; bottom: 0; width: 40px; max-width: none;
  margin: 0; padding: 0; background: none; border: none; border-radius: 0; z-index: 50;
  display: flex; flex-direction: column; justify-content: center; align-items: flex-end;
  /* The rail spans the full height of the viewport. Without this it would
     swallow every click in that strip, including the toggle underneath it. */
  pointer-events: none; }
html.js #rail ol { pointer-events: auto; }
html.js #rail h2 { display: none; }
html.js #rail ol { list-style: none; padding: 8px 0; margin: 0; max-height: 100vh;
  overflow-y: auto; overflow-x: visible; scrollbar-width: none; }
html.js #rail ol::-webkit-scrollbar { display: none; }
html.js #rail li { margin: 0; }
html.js #rail a { display: block; position: relative; padding: 3px 14px 3px 8px; }
/* The tick is a pseudo-element, not markup: on a 150-prompt thread that is
   ~4 KB of the export saved for one CSS rule. */
html.js #rail a::before { content: ""; display: block; height: 2px; width: 10px; margin-left: auto;
  background: #b9bec4; border-radius: 1px; transition: width .12s ease, background .12s ease; }
html.js #rail a:hover::before, html.js #rail a:focus-visible::before { width: 20px; background: #6e7781; }
html.js #rail li.active a::before { width: 22px; background: #10a37f; }
/* The rail scrolls, and overflow-y:auto forces overflow-x:auto, so a tooltip
   nested inside it would be clipped to the 40px strip. In JS mode the label
   stays in the DOM for screen readers and one shared tooltip element lives
   outside the rail instead. */
html.js #rail a span { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
#rail-tip { position: fixed; z-index: 60; transform: translateY(-50%); max-width: 44vw;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #1f2328;
  color: #fff; font-size: 12px; padding: 4px 9px; border-radius: 4px; pointer-events: none;
  opacity: 0; transition: opacity .12s ease; }
#rail-tip.on { opacity: 1; }
html.js #rail.hidden ol { display: none; }
html.js #rail-toggle { display: block; position: fixed; top: 12px; right: 10px; font-size: 11px;
  padding: 3px 8px; border: 1px solid #d0d7de; background: #fff; color: #57606a;
  border-radius: 4px; cursor: pointer; z-index: 51; }
html.js #rail-toggle:hover { background: #f3f4f6; }
html.js .wrap { padding-right: 44px; }

@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media (max-width: 700px) { html.js #rail { display: none; } html.js .wrap { padding-right: 0; } }
`;

    // Written without template literals or backticks so it can be embedded in
    // one. Progressive enhancement only: everything here is optional.
    const EXPORT_JS = [
        '(function () {',
        '  var root = document.documentElement;',
        "  root.className = root.className ? root.className + ' js' : 'js';",
        '',
        "  document.addEventListener('click', function (ev) {",
        '    var btn = ev.target;',
        "    if (!btn || btn.className !== 'copy-btn') return;",
        "    var box = btn.parentNode.querySelector('.content');",
        '    if (!box) return;',
        '    copy(box.innerText, btn);',
        '  });',
        '',
        '  function copy(text, btn) {',
        '    var ok = function () { flash(btn, "Copied"); };',
        '    var bad = function () { flash(btn, "Copy failed"); };',
        '    if (navigator.clipboard && navigator.clipboard.writeText) {',
        '      navigator.clipboard.writeText(text).then(ok, function () { legacy(text) ? ok() : bad(); });',
        '    } else {',
        '      legacy(text) ? ok() : bad();',
        '    }',
        '  }',
        '  function flash(btn, msg) {',
        '    btn.textContent = msg;',
        '    setTimeout(function () { btn.textContent = "Copy"; }, 1600);',
        '  }',
        '  function legacy(text) {',
        '    try {',
        '      var ta = document.createElement("textarea");',
        '      ta.value = text;',
        '      ta.setAttribute("readonly", "");',
        '      ta.style.position = "fixed";',
        '      ta.style.top = "-1000px";',
        '      document.body.appendChild(ta);',
        '      ta.select();',
        '      var done = document.execCommand("copy");',
        '      ta.parentNode.removeChild(ta);',
        '      return done;',
        '    } catch (e) { return false; }',
        '  }',
        '',
        '  var rail = document.getElementById("rail");',
        '  if (!rail) return;',
        '  var toggle = document.getElementById("rail-toggle");',
        '',
        '  function setHidden(h) {',
        '    rail.className = h ? "hidden" : "";',
        '    if (toggle) {',
        '      toggle.textContent = h ? "Nav" : "Hide";',
        '      toggle.setAttribute("aria-expanded", h ? "false" : "true");',
        '    }',
        '    try { sessionStorage.setItem("cge-rail-hidden", h ? "1" : "0"); } catch (e) {}',
        '  }',
        '  var stored = "0";',
        '  try { stored = sessionStorage.getItem("cge-rail-hidden") || "0"; } catch (e) {}',
        '  setHidden(stored === "1");',
        '  if (toggle) toggle.addEventListener("click", function () {',
        '    setHidden(rail.className !== "hidden");',
        '    hideTip();',
        '  });',
        '',
        '  var items = [];',
        '  var links = rail.querySelectorAll("ol a[href^=\'#\']");',
        '  for (var i = 0; i < links.length; i++) {',
        '    var el = document.getElementById(links[i].getAttribute("href").slice(1));',
        '    if (el) items.push({ a: links[i], li: links[i].parentNode, el: el });',
        '  }',
        '  if (!items.length) return;',
        '',
        '  var tip = document.createElement("div");',
        '  tip.id = "rail-tip";',
        '  document.body.appendChild(tip);',
        '  function showTip(a) {',
        '    var r = a.getBoundingClientRect();',
        '    tip.textContent = a.textContent;',
        '    tip.style.top = (r.top + r.height / 2) + "px";',
        '    tip.style.right = (window.innerWidth - r.left + 8) + "px";',
        '    tip.className = "on";',
        '  }',
        '  function hideTip() { if (tip) tip.className = ""; }',
        '  var list = rail.querySelector("ol");',
        '  list.addEventListener("mouseover", function (e) {',
        '    var a = e.target.closest ? e.target.closest("a") : null;',
        '    if (a && list.contains(a)) showTip(a);',
        '  });',
        '  list.addEventListener("mouseleave", hideTip);',
        '  list.addEventListener("focusin", function (e) {',
        '    if (e.target.tagName === "A") showTip(e.target);',
        '  });',
        '  list.addEventListener("focusout", hideTip);',
        '  list.addEventListener("scroll", hideTip);',
        '',
        '  var current = -1;',
        '  var visible = Object.create(null);',
        '  function paint(i) {',
        '    if (i < 0 || i === current) return;',
        '    if (current >= 0) items[current].li.className = "";',
        '    items[i].li.className = "active";',
        '    current = i;',
        '  }',
        '  function recompute() {',
        '    for (var i = 0; i < items.length; i++) {',
        '      if (visible[items[i].el.id]) { paint(i); return; }',
        '    }',
        '  }',
        '  if (window.IntersectionObserver) {',
        '    var io = new IntersectionObserver(function (entries) {',
        '      for (var k = 0; k < entries.length; k++) {',
        '        var e = entries[k];',
        '        if (e.isIntersecting) visible[e.target.id] = 1; else delete visible[e.target.id];',
        '      }',
        '      recompute();',
        '    }, { rootMargin: "-8% 0px -55% 0px", threshold: 0 });',
        '    for (var j = 0; j < items.length; j++) io.observe(items[j].el);',
        '  }',
        '  paint(0);',
        '',
        '  function go(delta) {',
        '    var next = current < 0 ? 0 : current + delta;',
        '    if (next < 0) next = 0;',
        '    if (next > items.length - 1) next = items.length - 1;',
        '    items[next].el.scrollIntoView({ behavior: "smooth", block: "start" });',
        '    paint(next);',
        '  }',
        '  document.addEventListener("keydown", function (e) {',
        '    if (e.ctrlKey || e.metaKey) return;',
        '    var t = e.target;',
        '    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;',
        '    var k = e.key;',
        '    if (k === "j" || k === "n" || (e.altKey && k === "ArrowDown")) { e.preventDefault(); go(1); }',
        '    else if (k === "k" || k === "p" || (e.altKey && k === "ArrowUp")) { e.preventDefault(); go(-1); }',
        '  });',
        '})();'
    ].join('\n');

    function renderHtml(messages, stats, meta) {
        const title = escapeHtml(meta.title);
        const iso = stats.capturedAt.toISOString();

        const rail = [];
        const body = [];

        messages.forEach((msg, i) => {
            const id = 'm-' + String(i).padStart(4, '0');
            const cls = roleClass(msg.role);
            body.push(
                '<article class="message ' + cls + '" id="' + id + '">' +
                '<h2>' + escapeHtml(roleLabel(msg.role)) + '</h2>' +
                '<button class="copy-btn" type="button">Copy</button>' +
                '<div class="content">' + mdToSafeHtml(msg.text) + '</div>' +
                '</article>'
            );
            if (cls === 'user') {
                rail.push('<li><a href="#' + id + '"><span>' +
                    escapeHtml(railLabel(msg.text)) + '</span></a></li>');
            }
        });

        const flag = stats.complete
            ? '<span class="flag-ok">complete</span>'
            : '<span class="flag-warn">possibly truncated</span>';

        const warning = stats.complete ? '' :
            '<p class="warn-box"><strong>Capture may be incomplete.</strong> ' +
            escapeHtml(stats.reasons.join('; ')) + '. Re-run the export from the top of the thread.</p>';

        const sourceLink = isSafeUrl(meta.url)
            ? '<a href="' + escapeHtml(meta.url) + '" rel="noopener noreferrer">' + escapeHtml(meta.url) + '</a>'
            : escapeHtml(meta.url);

        return '<!DOCTYPE html>\n' +
            '<html lang="en">\n<head>\n' +
            '<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
            // Belt and braces: even if a future escaping bug let something
            // through, this file structurally cannot reach the network.
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
            'style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; ' +
            'form-action \'none\'; base-uri \'none\'">\n' +
            '<title>' + title + '</title>\n' +
            '<style>' + EXPORT_CSS + '</style>\n' +
            '</head>\n<body>\n' +
            '<button id="rail-toggle" type="button" aria-controls="rail" aria-expanded="true">Hide</button>\n' +
            '<nav id="rail" aria-label="Prompts">\n<h2>Prompts</h2>\n<ol>\n' +
            rail.join('\n') +
            '\n</ol>\n</nav>\n' +
            '<div class="wrap">\n' +
            '<header class="export-head">\n' +
            '<h1>' + title + '</h1>\n' +
            '<p class="meta">Exported <time datetime="' + escapeHtml(iso) + '">' +
            escapeHtml(stats.capturedAt.toLocaleString()) + '</time> · ' +
            stats.count + ' messages · capture: ' + flag + '</p>\n' +
            '<p class="meta">Source: ' + sourceLink + '</p>\n' +
            warning +
            '</header>\n<main>\n' +
            body.join('\n') +
            '\n</main>\n</div>\n' +
            '<script>' + EXPORT_JS + '</script>\n' +
            '</body>\n</html>\n';
    }

    // -----------------------------------------------------------------------
    // Export flow
    // -----------------------------------------------------------------------

    async function exportChat(format, loader) {
        const meta = { title: conversationTitle(), url: location.href };
        const { messages, stats } = await captureMessages(loader);

        if (!messages.length) {
            return { stats, downloaded: false, reason: 'No messages were found on this page.' };
        }

        const base = sanitizeFilename(meta.title, 'chatgpt-export') + '-' + isoDate(stats.capturedAt);

        if (format === 'markdown') {
            downloadFile(renderMarkdown(messages, stats, meta), base + '.md', 'text/markdown;charset=utf-8');
        } else {
            downloadFile(renderHtml(messages, stats, meta), base + '.html', 'text/html;charset=utf-8');
        }
        return { stats, downloaded: true };
    }

    // -----------------------------------------------------------------------
    // UI (built with createElement throughout: never innerHTML, so the script
    // keeps working on a page that enforces Trusted Types)
    // -----------------------------------------------------------------------

    function el(tag, props, children) {
        const node = document.createElement(tag);
        if (props) {
            for (const k in props) {
                if (k === 'style') node.style.cssText = props[k];
                else if (k === 'text') node.textContent = props[k];
                else node.setAttribute(k, props[k]);
            }
        }
        (children || []).forEach(c => node.appendChild(c));
        return node;
    }

    const BTN_BASE = 'padding:10px 18px; font-size:14px; border:none; border-radius:6px;' +
        'cursor:pointer; color:#fff; margin:5px; font-family:inherit;';

    function showExportModal() {
        if (document.querySelector('.export-modal-overlay')) return;

        const overlay = el('div', {
            'class': 'export-modal-overlay',
            style: 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex;' +
                'justify-content:center; align-items:center; z-index:2147483000;'
        });

        const modal = el('div', {
            style: 'background:#fff; color:#24292f; padding:28px 30px; border-radius:12px;' +
                'text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.2); max-width:420px;' +
                'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        });

        const mdBtn = el('button', { type: 'button', style: BTN_BASE + 'background:#2563eb;', text: 'Download Markdown' });
        const htmlBtn = el('button', { type: 'button', style: BTN_BASE + 'background:#10a37f;', text: 'Download HTML' });
        const closeBtn = el('button', { type: 'button', style: BTN_BASE + 'background:#6b7280;', text: 'Cancel' });
        const status = el('p', { style: 'color:#57606a; font-size:13px; margin:14px 0 0; white-space:pre-line;' });

        modal.appendChild(el('h3', { style: 'margin:0 0 8px; font-size:18px;', text: 'Export Chat Thread' }));
        modal.appendChild(el('p', {
            style: 'color:#57606a; margin:0 0 18px; font-size:13px;',
            text: 'Auto-scrolls the whole thread first, then reports whether the capture was complete.'
        }));
        modal.appendChild(mdBtn);
        modal.appendChild(htmlBtn);
        modal.appendChild(el('br'));
        modal.appendChild(closeBtn);
        modal.appendChild(status);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const run = async (format, btn) => {
            const buttons = [mdBtn, htmlBtn, closeBtn];
            const label = btn.textContent;
            buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
            btn.textContent = 'Working...';
            overlay.style.visibility = 'hidden';

            const loader = makeLoader();
            let result = null;
            let error = null;
            try {
                result = await exportChat(format, loader);
            } catch (err) {
                error = err;
            } finally {
                // Guaranteed: a throw mid-capture used to leave this overlay
                // pinned over the page with no way back except a reload.
                loader.remove();
                overlay.style.visibility = '';
                buttons.forEach(b => { b.disabled = false; b.style.opacity = ''; });
                btn.textContent = label;
            }

            if (error) {
                status.style.color = '#b35900';
                status.textContent = 'Export failed: ' + (error && error.message ? error.message : String(error));
                return;
            }
            if (!result.downloaded) {
                status.style.color = '#b35900';
                status.textContent = result.reason || 'Nothing was exported.';
                return;
            }
            const s = result.stats;
            if (s.complete) {
                close();
            } else {
                status.style.color = '#9a6700';
                status.textContent = 'Downloaded ' + s.count + ' messages, but the capture may be incomplete:\n' +
                    s.reasons.join('; ') + '.\nThe file is flagged accordingly.';
            }
        };

        mdBtn.addEventListener('click', () => run('markdown', mdBtn));
        htmlBtn.addEventListener('click', () => run('html', htmlBtn));
    }

    // -----------------------------------------------------------------------
    // In-page decorations
    // -----------------------------------------------------------------------

    const decorated = new WeakSet();

    function addCopyButtons() {
        const messages = document.querySelectorAll(MSG_SELECTOR);
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            // The old version re-queried and re-ran getComputedStyle on every
            // message on every mutation. ChatGPT emits a mutation per streamed
            // token, so this is the difference between a few hundred style
            // resolutions and a few hundred thousand.
            if (decorated.has(msg)) continue;
            decorated.add(msg);
            if (msg.querySelector('.custom-copy-btn')) continue;

            const btn = el('button', {
                'class': 'custom-copy-btn',
                type: 'button',
                text: 'Copy',
                style: 'position:absolute; top:5px; right:5px; z-index:10; padding:2px 8px;' +
                    'font-size:12px; background:#10a37f; color:#fff; border:none;' +
                    'border-radius:4px; cursor:pointer; opacity:0.8;'
            });
            btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
            btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.8'; });
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const text = extractContent(msg);
                const done = ok => {
                    btn.textContent = ok ? 'Copied!' : 'Failed';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
                } else {
                    done(false);
                }
            });

            if (window.getComputedStyle(msg).position === 'static') msg.style.position = 'relative';
            msg.appendChild(btn);
        }
    }

    function addExportButton() {
        if (document.querySelector('.export-chat-btn')) return;
        const btn = el('button', {
            'class': 'export-chat-btn',
            type: 'button',
            text: 'Export Chat',
            style: 'position:fixed; bottom:20px; right:20px; z-index:2147482000; padding:10px 15px;' +
                'background:#10a37f; color:#fff; border:none; border-radius:8px; cursor:pointer;' +
                'box-shadow:0 4px 6px rgba(0,0,0,0.1); font-size:14px; font-weight:bold;' +
                'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        });
        btn.addEventListener('click', showExportModal);
        document.body.appendChild(btn);
    }

    let scheduled = false;

    function refresh() {
        scheduled = false;
        addCopyButtons();
        addExportButton();
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        if (window.requestIdleCallback) window.requestIdleCallback(refresh, { timeout: 600 });
        else setTimeout(refresh, 250);
    }

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    refresh();
})();
