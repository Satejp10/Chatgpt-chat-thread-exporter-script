// ==UserScript==
// @name         Chat Thread Exporter (Robust Auto-Scroll)
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Exports full ChatGPT and Claude threads (defeats virtualization/lazy loading) to Markdown/HTML. Preserves links and code blocks, reports capture completeness, lets you leave the conversation URL and title out, and makes zero network requests.
// @author       You
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @exclude      https://chatgpt.com/codex*
// @exclude      https://chat.openai.com/codex*
// @exclude      https://claude.ai/code*
// @grant        none
// ==/UserScript==

// The @exclude lines above cover the coding surfaces, which share a host with
// the chat app but are not chat threads. They are backed up by a runtime path
// check in refresh(), because both sites are single-page apps: navigating from
// a chat to /code or /codex changes the path without reloading the document,
// and @exclude is only evaluated at load.

// ---------------------------------------------------------------------------
// Design constraints (see .claude/context/LOG.md):
//   * No network requests, ever. No fetch/XHR/beacon/WebSocket/@connect.
//   * No eval, no Function(), no remote code, no auto-update.
//   * No persistence of conversation content. The only value ever stored is
//     the two-boolean export preference under 'cge-export-prefs'; the download
//     the user explicitly asks for is the only place content goes.
//   * No build step, no dependencies, single file.
//   * Never assign to innerHTML: the page may enforce Trusted Types, and the
//     export must be safe to open from disk.
//   * Nothing is ever dropped quietly. If a turn, or part of one, does not
//     make it into the file, the file says so.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    const STALL_PASSES = 3;      // consecutive zero-yield passes before we call it done
    const MAX_DOWN_STEPS = 4000; // hard ceiling; hitting it means "possibly truncated"
    const MAX_TOP_SEEKS = 400;   // hard ceiling on the lazy-prepend seek loop
    const STEP_SETTLE_MS = 220;
    const TOP_SETTLE_MS = 450;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // -----------------------------------------------------------------------
    // Site adapters
    //
    // Everything after this block is site-agnostic. The scroller, the walker,
    // both renderers, the rail and the modal never learn which site they ran
    // on. A site contributes four things and nothing else: how to find message
    // elements, how to tell whose turn it is, what the conversation is called,
    // and what to name the file.
    //
    // ChatGPT tags every turn with data-message-author-role, so one selector
    // covers it and the role is read straight off the attribute. Claude has no
    // such attribute: user and assistant turns are different elements, and the
    // class names have changed more than once. So Claude ships a list of
    // candidate layouts and the first one that actually matches the live page
    // wins. The chosen layout id travels into the export and into the failure
    // message, so a wrong guess shows up as a named layout rather than as a
    // mysteriously empty capture.
    // -----------------------------------------------------------------------

    const SITES = [
        {
            id: 'chatgpt',
            label: 'ChatGPT',
            slug: 'chatgpt-export',
            genericTitle: 'ChatGPT export',
            matches: h => /(^|\.)chatgpt\.com$/.test(h) || /(^|\.)chat\.openai\.com$/.test(h),
            titleTail: /\s*[|\-–—]\s*ChatGPT\s*$/i,
            titleIsEmpty: /^chatgpt$/i,
            excludePaths: [/^\/codex(?:\/|$)/i],
            layouts: [{
                id: 'author-role',
                user: '[data-message-author-role="user"]',
                assistant: '[data-message-author-role]:not([data-message-author-role="user"])',
                roleAttr: 'data-message-author-role',
                idAttr: 'data-message-id'
            }],
            // ChatGPT's canvas is not captured either, but it does not render
            // as a distinguishable cell inside the turn, so there is nothing
            // reliable to place a marker on. Left empty rather than guessed.
            artifacts: []
        },
        {
            id: 'claude',
            label: 'Claude',
            slug: 'claude-export',
            genericTitle: 'Claude export',
            matches: h => /(^|\.)claude\.ai$/.test(h),
            titleTail: /\s*[|\-–—\\\/]\s*Claude\s*$/i,
            titleIsEmpty: /^claude$/i,
            excludePaths: [/^\/code(?:\/|$)/i],
            layouts: [
                { id: 'testid', user: '[data-testid="user-message"]', assistant: '.font-claude-response' },
                { id: 'msg-class', user: '[data-testid="user-message"]', assistant: '.font-claude-message' },
                { id: 'legacy', user: '.font-user-message', assistant: '.font-claude-message' }
            ],
            artifacts: [
                '[data-testid="artifact-block-cell"]',
                '.artifact-block-cell',
                '[aria-label^="Preview contents"]'
            ]
        }
    ];

    // Checked on every refresh, not once at startup. Both sites are single-page
    // apps: navigating from a chat to the coding surface changes the path
    // without a reload, so a one-time check would leave the button behind.
    function onExcludedPath() {
        if (!SITE || !SITE.excludePaths) return false;
        const path = location.pathname || '';
        return SITE.excludePaths.some(re => re.test(path));
    }

    function pickSite() {
        const host = location.hostname;
        for (const s of SITES) {
            if (s.matches(host)) return s;
        }
        return null;
    }

    const SITE = pickSite();

    // Stands in for the conversation title whenever the real one is withheld,
    // and doubles as the fallback for a chat that has no title yet.
    const GENERIC_TITLE = SITE ? SITE.genericTitle : 'Chat export';

    function safeCount(selector) {
        try {
            return document.querySelectorAll(selector).length;
        } catch (e) {
            // A selector this browser will not parse is simply not a candidate.
            return 0;
        }
    }

    function safeMatches(node, selector) {
        try {
            return !!(node.matches && node.matches(selector));
        } catch (e) {
            return false;
        }
    }

    let cachedLayout = null;

    // Resolved lazily and re-resolved until a layout matches both roles: at
    // script start the thread is usually not mounted yet, and the answer would
    // be wrong if cached then. A layout matching only one role is used but not
    // cached, because a new chat, or a capture begun before the reply lands,
    // legitimately has one role on screen and a better match may still appear.
    function layout() {
        if (cachedLayout) return cachedLayout;
        let partial = null;
        for (const l of SITE.layouts) {
            const users = safeCount(l.user);
            const assistants = safeCount(l.assistant);
            if (users > 0 && assistants > 0) {
                cachedLayout = l;
                return l;
            }
            if (!partial && users + assistants > 0) partial = l;
        }
        return partial || SITE.layouts[0];
    }

    function messageSelector(l) {
        return l.user + ', ' + l.assistant;
    }

    // Cheap count for the scroll loops, which only need to know whether the
    // number is still growing. The nesting filter below is not worth paying
    // for hundreds of times per capture.
    function mountedCount() {
        return safeCount(messageSelector(layout()));
    }

    function firstMessageEl() {
        try {
            return document.querySelector(messageSelector(layout()));
        } catch (e) {
            return null;
        }
    }

    function roleOf(node, l) {
        if (l.roleAttr) {
            const v = node.getAttribute(l.roleAttr);
            if (v) return v;
        }
        return safeMatches(node, l.user) ? 'user' : 'assistant';
    }

    // Returns { el, role } for every turn on the page, in document order.
    function listMessages() {
        const l = layout();
        let nodes;
        try {
            nodes = Array.prototype.slice.call(document.querySelectorAll(messageSelector(l)));
        } catch (e) {
            return [];
        }
        // Drop any match sitting inside another match. On Claude an assistant
        // container and the prose block within it can both hit, which would
        // otherwise export the same turn twice. Checked by walking each node's
        // ancestors rather than comparing every pair, so this stays linear.
        const set = new Set(nodes);
        const out = [];
        for (const n of nodes) {
            let p = n.parentElement;
            let nested = false;
            while (p) {
                if (set.has(p)) { nested = true; break; }
                p = p.parentElement;
            }
            if (!nested) out.push({ el: n, role: roleOf(n, l) });
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Artifacts and embedded views
    //
    // v5.0 does not export artifact contents. What it will not do is drop them
    // in silence: each one leaves a marked placeholder where it stood and is
    // counted into the export header, so a reader can see precisely what is
    // missing and how much of it. Same rule as the capture flag.
    // -----------------------------------------------------------------------

    const ARTIFACT_SELECTOR = SITE && SITE.artifacts.length ? SITE.artifacts.join(', ') : '';

    let artifactCount = 0;

    function artifactName(node) {
        const flat = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        return flat.length > 60 ? flat.slice(0, 59) + '…' : flat;
    }

    function artifactPlaceholder(kind, name) {
        artifactCount++;
        return '\n\n> [' + kind + ' not exported' + (name ? ': ' + name : '') + ']\n\n';
    }

    // -----------------------------------------------------------------------
    // Timestamps
    //
    // Transcribed, never synthesized. The page renders a date and time at the
    // start of a thread, and separators between later turn groups. Whatever it
    // renders is captured exactly as written.
    //
    // A relative label ("Yesterday 8:30 PM") is exported as that string and is
    // NOT resolved into a date. Resolving it against the capture time would be
    // inventing a fact the page never showed, which the never-synthesize rule
    // forbids. The export header already carries the absolute capture time, so
    // a reader can anchor a relative label themselves.
    //
    // Where the page also holds a machine-readable value, a <time datetime> or
    // a title attribute, that is captured alongside as `exact`. It is copied,
    // not parsed: whatever the attribute says is what gets written.
    //
    // A turn with no rendered label gets no timestamp. Labels are never
    // inherited from the turn above, because "the page showed nothing here" and
    // "the page showed the same thing here" are different claims.
    // -----------------------------------------------------------------------

    const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
    const WEEKDAYS = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*';
    const CLOCK = '\\d{1,2}[:.]\\d{2}(?:\\s*[ap]\\.?m\\.?)?';
    const AT = '(?:\\s*(?:at|,)\\s*)?';

    const TIME_LABEL_RES = [
        new RegExp('^(?:today|yesterday)' + AT + '(?:' + CLOCK + ')?$', 'i'),
        new RegExp('^' + WEEKDAYS + AT + '(?:' + CLOCK + ')?$', 'i'),
        new RegExp('^' + MONTHS + '\\s+\\d{1,2}(?:,?\\s*\\d{4})?' + AT + '(?:' + CLOCK + ')?$', 'i'),
        new RegExp('^\\d{1,2}\\s+' + MONTHS + '(?:,?\\s*\\d{4})?' + AT + '(?:' + CLOCK + ')?$', 'i'),
        new RegExp('^\\d{4}-\\d{2}-\\d{2}(?:[ T]' + CLOCK + ')?$', 'i'),
        new RegExp('^\\d{1,2}[\\/.]\\d{1,2}[\\/.]\\d{2,4}' + AT + '(?:' + CLOCK + ')?$', 'i'),
        new RegExp('^' + CLOCK + '$', 'i')
    ];

    // Long enough for "Wednesday, September 10, 2026 at 11:45 PM", short enough
    // that a paragraph opening with a date cannot pass as a separator.
    const MAX_LABEL_LEN = 48;
    const LABEL_LOOKBACK_SIBLINGS = 6;
    // Deep rather than shallow. The message node can sit several levels inside
    // its turn container, so a low ceiling means finding nothing at all. Going
    // deeper is safe because the ascent stops at the previous turn either way,
    // and the cost of overshooting is a miss, not a wrong attribution.
    const LABEL_LOOKUP_DEPTH = 8;

    function flatten(text) {
        return stripControl(String(text == null ? '' : text)).replace(/\s+/g, ' ').trim();
    }

    function looksLikeTimeLabel(text) {
        if (!text || text.length > MAX_LABEL_LEN) return false;
        for (const re of TIME_LABEL_RES) {
            if (re.test(text)) return true;
        }
        return false;
    }

    // Reads a candidate separator element. Returns { shown, exact } or null.
    function readTimeLabel(node) {
        if (!node || node.nodeType !== 1) return null;

        // A <time> element is unambiguous, so it is preferred wherever one
        // exists and is accepted without the text having to look date-like.
        const timeEl = node.tagName === 'TIME'
            ? node
            : (node.querySelector ? node.querySelector('time') : null);
        if (timeEl) {
            const shown = flatten(timeEl.textContent);
            const exact = flatten(timeEl.getAttribute('datetime'));
            if (shown || exact) return { shown: shown || exact, exact: exact };
        }

        const text = flatten(node.textContent);
        if (!looksLikeTimeLabel(text)) return null;

        const titled = node.getAttribute('title') ||
            (node.querySelector && node.querySelector('[title]')
                ? node.querySelector('[title]').getAttribute('title')
                : '');
        return { shown: text, exact: flatten(titled) };
    }

    // Searches a bounded neighbourhood before a turn: previous siblings at each
    // of a few ancestor levels. Bounded deliberately. An unbounded walk would
    // eventually find some unrelated date elsewhere on the page and staple it
    // to the wrong turn, which is worse than reporting no timestamp at all.
    function findTimeFor(msgEl, msgSel) {
        let node = msgEl;
        for (let depth = 0; node && depth < LABEL_LOOKUP_DEPTH; depth++) {
            let sib = node.previousElementSibling;
            for (let i = 0; sib && i < LABEL_LOOKBACK_SIBLINGS; i++) {
                // Stop at the previous turn. Anything beyond it belongs to that
                // turn's group, not to this one.
                if (safeMatches(sib, msgSel) ||
                    (sib.querySelector && sib.querySelector(msgSel))) return null;
                const hit = readTimeLabel(sib);
                if (hit) return hit;
                sib = sib.previousElementSibling;
            }
            node = node.parentElement;
        }
        return null;
    }

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
        const raw = (document.title || '').replace(SITE.titleTail, '').trim();
        if (!raw || SITE.titleIsEmpty.test(raw)) return GENERIC_TITLE;
        return raw;
    }

    function isoDate(d) {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function clockSuffix(d) {
        const p = n => String(n).padStart(2, '0');
        return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    // -----------------------------------------------------------------------
    // Export preferences
    //
    // Two booleans deciding whether the conversation's URL and title are
    // written into the export. No conversation content is ever stored here.
    //
    // This lives in the site's own localStorage, which the page's scripts can
    // also write to, so the value is treated as untrusted input: only
    // fields that are already booleans are accepted, and only booleans are
    // written back. A tampered or corrupt entry can therefore never reach a
    // renderer as anything other than true or false.
    // -----------------------------------------------------------------------

    const PREF_KEY = 'cge-export-prefs';
    const PREF_FIELDS = ['url', 'title'];

    function defaultPrefs() {
        // Provenance is on by default; leaving it out is the deliberate act.
        return { url: true, title: true };
    }

    function loadPrefs() {
        const prefs = defaultPrefs();
        try {
            const stored = JSON.parse(localStorage.getItem(PREF_KEY));
            if (stored && typeof stored === 'object') {
                PREF_FIELDS.forEach(k => {
                    if (typeof stored[k] === 'boolean') prefs[k] = stored[k];
                });
            }
        } catch (e) {
            // Disabled storage, private mode, corrupt JSON, or no localStorage
            // binding at all: the defaults stand and the export still runs.
        }
        return prefs;
    }

    function savePrefs(prefs) {
        try {
            const out = {};
            PREF_FIELDS.forEach(k => { out[k] = !!(prefs && prefs[k]); });
            localStorage.setItem(PREF_KEY, JSON.stringify(out));
        } catch (e) {
            // Not being able to remember the choice must not block the export.
        }
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
        clone.querySelectorAll('button, svg').forEach(el => el.remove());
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

        // Both checks run before SKIP_TAGS and before the role=button rule,
        // which would otherwise swallow these without trace: an artifact cell
        // is usually a button, and an embedded view is an iframe.
        if (ARTIFACT_SELECTOR && safeMatches(node, ARTIFACT_SELECTOR)) {
            return artifactPlaceholder('artifact', artifactName(node));
        }
        if (tag === 'IFRAME') {
            return artifactPlaceholder('embedded view', node.getAttribute('title') || '');
        }

        if (SKIP_TAGS.has(tag)) return '';
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
        clone.querySelectorAll('button, svg, img').forEach(el => el.remove());
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
        const anchor = firstMessageEl();
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
            'min-width:280px; max-width:360px; box-shadow:0 4px 12px rgba(0,0,0,0.3);';

        const status = el('div', { style: 'white-space:pre-line;', text: 'Loading conversation...' });

        // Browsers throttle timers in a background tab and suspend the
        // rendering work that ChatGPT's lazy loading is driven by, so a capture
        // run with the tab hidden can stall and come back short.
        const note = el('div', {
            style: 'margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.18);' +
                'font-size:12.5px; line-height:1.5; color:#ffd48a;',
            text: 'Keep this tab visible until it finishes. Switching tabs or minimising the ' +
                'window throttles the page, which can stall the capture and leave the export short.'
        });

        box.appendChild(status);
        box.appendChild(note);
        document.body.appendChild(box);

        // Advisory only. It records that the tab went hidden so an incomplete
        // capture can say why, and it never changes what gets captured.
        let hidden = !!document.hidden;
        const onVisibility = () => { if (document.hidden) hidden = true; };
        document.addEventListener('visibilitychange', onVisibility);

        box.setStatus = text => { status.textContent = text; };
        box.wasHidden = () => hidden;
        box.stopWatching = () => document.removeEventListener('visibilitychange', onVisibility);
        return box;
    }

    async function captureMessages(loader) {
        const messages = [];
        const seen = new Set();
        // Node identity and content identity catch different things: the first
        // stops re-collecting a node still on screen, the second stops a
        // remounted turn from being counted twice.
        const seenNodes = new WeakSet();
        let duplicates = 0;
        artifactCount = 0;
        // The first label seen while descending, so the topmost one in the
        // thread: what the page shows as the start of the session.
        let started = null;
        const ctl = makeScrollCtl(findScroller());
        const startedAt = Date.now();
        const originalTop = ctl.top();

        let emptySkipped = 0;

        const say = text => { if (loader && loader.setStatus) loader.setStatus(text); };

        const collect = () => {
            let added = 0;
            // Re-read per pass: on Claude the layout is only pinned once both
            // roles are on screen, which may not be true at the first pass.
            const idAttr = layout().idAttr;
            const msgSel = messageSelector(layout());
            const nodes = listMessages();
            for (let i = 0; i < nodes.length; i++) {
                const msg = nodes[i].el;
                const role = nodes[i].role || 'unknown';

                // Cheapest and most exact check: this very node was already
                // collected. Costs nothing on the passes where nothing is new,
                // which is most of them.
                if (seenNodes.has(msg)) continue;
                seenNodes.add(msg);

                const explicitId = idAttr ? msg.getAttribute(idAttr) : '';
                if (explicitId && seen.has(explicitId)) { duplicates++; continue; }

                const text = extractContent(msg);
                if (!text) { emptySkipped++; continue; }

                // Identity for a site with no message id, such as Claude.
                //
                // This used to be a DOM path, and it was wrong. A path is an
                // index chain among siblings, and virtualization renumbers
                // those constantly: the same turn remounts at a different index
                // and reads as a brand new message. On a real 14-message Claude
                // thread it produced 29, with one turn duplicated five times.
                //
                // The full text is used, never a prefix. A prefix was tried in
                // v4.0 and merged genuinely distinct short turns. The residual
                // risk is the inverse, two identical turns collapsing into one,
                // so every merge is counted and the count goes in the export.
                const key = explicitId || ('txt:' + role + ':' + text);
                if (seen.has(key)) { duplicates++; continue; }
                seen.add(key);

                // Read once, on first sight. The neighbourhood is still mounted
                // now; after the scroller moves on it may not be.
                const time = findTimeFor(msg, msgSel);
                if (time && !started) started = time;
                messages.push({ id: key, role, text, time });
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
            const n = mountedCount();
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
        // Listed last, and only when something actually went wrong: it is the
        // likely cause of the reasons above rather than a finding of its own.
        if (!complete && loader && loader.wasHidden && loader.wasHidden()) {
            reasons.push('the tab was hidden during capture, which throttles loading');
        }

        return {
            messages,
            stats: {
                count: messages.length,
                emptySkipped,
                artifacts: artifactCount,
                duplicates,
                started,
                timestamped: messages.filter(m => m.time).length,
                app: SITE.label,
                layout: layout().id,
                complete,
                reasons,
                durationMs: Date.now() - startedAt,
                capturedAt: new Date()
            }
        };
    }

    // -----------------------------------------------------------------------
    // Markdown renderer
    // -----------------------------------------------------------------------

    function renderMarkdown(messages, stats, meta) {
        const lines = [];
        lines.push('---');
        // A withheld field is left out of the frontmatter entirely. It is never
        // emitted empty and never as null: absent must mean absent, so a parser
        // cannot mistake a redaction for a value.
        if (meta.title) lines.push('title: ' + JSON.stringify(meta.title));
        if (meta.url) lines.push('source: ' + JSON.stringify(meta.url));
        lines.push('exported: ' + stats.capturedAt.toISOString());
        lines.push('messages: ' + stats.count);
        lines.push('capture: ' + (stats.complete ? 'complete' : 'possibly-truncated'));
        if (!stats.complete && stats.reasons.length) {
            lines.push('capture_notes: ' + JSON.stringify(stats.reasons.join('; ')));
        }
        // Only written when there were any, so its presence means something is
        // genuinely missing. A zero line would be noise on every other export.
        if (stats.artifacts) lines.push('artifacts_not_exported: ' + stats.artifacts);
        // Copied from the page verbatim. `started` may be relative ("Yesterday
        // 8:30 PM"); resolve it against `exported` above if you need a date.
        // It is deliberately not resolved here.
        if (stats.started) {
            lines.push('started_label: ' + JSON.stringify(stats.started.shown));
            if (stats.started.exact) lines.push('started_exact: ' + JSON.stringify(stats.started.exact));
        }
        if (stats.timestamped) lines.push('timestamped_messages: ' + stats.timestamped);
        // Only meaningful on a site with no message ids, where identity is the
        // text itself. Reported so an over-merge is visible rather than silent.
        if (stats.duplicates) lines.push('merged_duplicates: ' + stats.duplicates);
        lines.push('app: ' + JSON.stringify(stats.app));
        lines.push('generator: Chat Thread Exporter');
        lines.push('---');
        lines.push('');
        lines.push('# ' + (meta.title || GENERIC_TITLE).replace(/\n/g, ' '));
        lines.push('');
        if (!stats.complete) {
            lines.push('> **Capture may be incomplete.** ' + stats.reasons.join('; ') + '.');
            lines.push('');
        }
        if (stats.artifacts) {
            lines.push('> **' + stats.artifacts + ' artifact(s) or embedded view(s) were not exported.** ' +
                'Each one is marked in place below.');
            lines.push('');
        }

        messages.forEach((msg, i) => {
            const n = i + 1;
            // The index in both the marker and the heading makes turn boundaries
            // verifiable: a parser can check they run 1..N against the `messages`
            // count above. Message text can imitate a heading, but it cannot
            // produce a correctly numbered monotonic sequence.
            const t = msg.time;
            lines.push('<!-- msg:' + n + ' role:' + roleClass(msg.role) +
                (t ? ' time:' + JSON.stringify(t.exact || t.shown) : '') + ' -->');
            lines.push('## [' + n + '] ' + roleLabel(msg.role) + (t ? ' (' + t.shown + ')' : ''));
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
.msg-time { font-weight: 400; letter-spacing: 0; color: #8b949e; margin-left: 8px; font-size: 0.92em; }
.meta .exact { color: #57606a; }
.meta .verbatim { color: #8b949e; font-style: italic; }
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
        const title = escapeHtml(meta.title || GENERIC_TITLE);
        const iso = stats.capturedAt.toISOString();

        const rail = [];
        const body = [];

        messages.forEach((msg, i) => {
            const id = 'm-' + String(i).padStart(4, '0');
            const cls = roleClass(msg.role);
            body.push(
                '<article class="message ' + cls + '" id="' + id + '">' +
                '<h2>' + escapeHtml(roleLabel(msg.role)) +
                (msg.time
                    ? '<span class="msg-time"' +
                      (msg.time.exact ? ' title="' + escapeHtml(msg.time.exact) + '"' : '') +
                      '>' + escapeHtml(msg.time.shown) + '</span>'
                    : '') + '</h2>' +
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

        // Separate from the capture flag on purpose. A truncated capture means
        // the exporter does not know what it missed; this one means it knows
        // exactly what it missed and left a marker at each spot.
        // Relative by nature on most pages, and left that way. The absolute
        // export time sits directly above it, which is the anchor a reader
        // needs to resolve it.
        const startedBlock = !stats.started ? '' :
            '<p class="meta">Thread starts: ' + escapeHtml(stats.started.shown) +
            (stats.started.exact && stats.started.exact !== stats.started.shown
                ? ' <span class="exact">(' + escapeHtml(stats.started.exact) + ')</span>'
                : '') +
            ' <span class="verbatim">as shown on the page, not resolved</span></p>\n';

        const dupBlock = !stats.duplicates ? '' :
            '<p class="meta">' + stats.duplicates + ' repeated copies of already-captured turns ' +
            'were merged. ' + SITE.label + ' remounts turns while scrolling, and this thread has ' +
            'no per-message ids, so identical text is treated as the same turn.</p>\n';

        const artifactBlock = !stats.artifacts ? '' :
            '<p class="warn-box"><strong>' + stats.artifacts + ' artifact(s) or embedded view(s) ' +
            'were not exported.</strong> Each is marked in place below. Text, links and code ' +
            'blocks are unaffected.</p>';

        // Withheld means the line is not written at all, rather than written
        // blank: an empty "Source:" would still tell a reader one existed.
        const sourceBlock = !meta.url ? '' :
            '<p class="meta">Source: ' + (isSafeUrl(meta.url)
                ? '<a href="' + escapeHtml(meta.url) + '" rel="noopener noreferrer">' + escapeHtml(meta.url) + '</a>'
                : escapeHtml(meta.url)) + '</p>\n';

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
            startedBlock +
            dupBlock +
            sourceBlock +
            warning +
            artifactBlock +
            '</header>\n<main>\n' +
            body.join('\n') +
            '\n</main>\n</div>\n' +
            '<script>' + EXPORT_JS + '</script>\n' +
            '</body>\n</html>\n';
    }

    // -----------------------------------------------------------------------
    // Export flow
    // -----------------------------------------------------------------------

    async function exportChat(format, loader, prefs) {
        const p = prefs || defaultPrefs();
        // Resolved here rather than inside the renderers, so those stay pure
        // functions of meta. null means "leave this out of the file".
        const meta = {
            title: p.title ? conversationTitle() : null,
            url: p.url ? location.href : null
        };
        const { messages, stats } = await captureMessages(loader);

        if (!messages.length) {
            // Name what was tried. On Claude a class-name change on the site is
            // the likeliest cause, and this line is what makes that fixable.
            return {
                stats,
                downloaded: false,
                reason: 'No messages were found on this page. Tried the "' + layout().id +
                    '" layout for ' + SITE.label + '. If the thread is clearly there, ' +
                    'the site has changed its markup and the selectors need updating.'
            };
        }

        // Without the title there is nothing left to tell two exports apart, so
        // the time is added. Date alone would collide on the second export of
        // the day and leave the browser to append " (1)".
        const base = meta.title
            ? sanitizeFilename(meta.title, SITE.slug) + '-' + isoDate(stats.capturedAt)
            : SITE.slug + '-' + isoDate(stats.capturedAt) + '-' + clockSuffix(stats.capturedAt);

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

    // Returns { input, node }. The caller reads input.checked at download time.
    function prefCheckbox(id, label, checked) {
        const input = el('input', { type: 'checkbox', id: id, style: 'margin:0 8px 0 0;' });
        // A property, not an attribute: setAttribute('checked') sets the
        // element's *default* state, which is not what gets read back.
        input.checked = checked;
        const node = el('label', {
            'for': id,
            style: 'display:flex; align-items:center; cursor:pointer;'
        }, [input]);
        node.appendChild(document.createTextNode(label));
        return { input: input, node: node };
    }

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

        // Two identifying fields, each optional. They sit here rather than in a
        // settings panel because the moment you choose a format is the moment
        // you know whether this particular export is one you will share.
        const stored = loadPrefs();
        const urlPref = prefCheckbox('cge-pref-url', 'Include the conversation URL', stored.url);
        const titlePref = prefCheckbox('cge-pref-title', 'Include the conversation title', stored.title);
        const readPrefs = () => ({ url: urlPref.input.checked, title: titlePref.input.checked });
        [urlPref, titlePref].forEach(p => {
            p.input.addEventListener('change', () => savePrefs(readPrefs()));
        });

        const prefBox = el('div', {
            style: 'display:flex; flex-direction:column; gap:8px; text-align:left;' +
                'margin:0 0 16px; padding:12px 14px; border:1px solid #d0d7de;' +
                'border-radius:8px; font-size:13px; color:#24292f;'
        }, [urlPref.node, titlePref.node]);
        prefBox.appendChild(el('p', {
            style: 'margin:2px 0 0; color:#57606a; font-size:12px; line-height:1.45;',
            text: 'Unticked fields are left out of the file entirely. Without the title, ' +
                'the filename falls back to the date and time.'
        }));

        modal.appendChild(el('h3', { style: 'margin:0 0 8px; font-size:18px;', text: 'Export Chat Thread' }));
        modal.appendChild(el('p', {
            style: 'color:#57606a; margin:0 0 14px; font-size:13px;',
            text: 'Auto-scrolls the whole ' + SITE.label + ' thread first, then reports whether ' +
                'the capture was complete. Artifacts and embedded views are not exported; ' +
                'any found are marked in the file and counted in its header.'
        }));

        // Advisory, and worth the space. The exporter does load the thread on
        // its own, but a thread the browser has already rendered captures
        // faster and stalls less, and a hand-scrolled pass is the one reliable
        // way to see for yourself that the history really did load.
        const prep = el('div', {
            style: 'text-align:left; margin:0 0 16px; padding:12px 14px; border-radius:8px;' +
                'background:#fff8e6; border:1px solid #f0d9a0; font-size:12.5px;' +
                'line-height:1.5; color:#5c4708;'
        });
        prep.appendChild(el('strong', { text: 'Before you export, scroll the thread yourself.' }));
        prep.appendChild(el('p', {
            style: 'margin:6px 0 0;',
            text: 'Scroll to the very top, wait for the older messages to appear, then scroll ' +
                'back to the bottom. The exporter does this on its own, but a thread that is ' +
                'already loaded captures faster and is far less likely to come back short.'
        }));
        prep.appendChild(el('p', {
            style: 'margin:6px 0 0;',
            text: 'Keep this tab visible for the whole run. A hidden tab is throttled by the ' +
                'browser and the capture can stall.'
        }));
        modal.appendChild(prep);

        modal.appendChild(prefBox);
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
                // Read from the boxes, not from storage: an untick made a
                // second ago must apply to this export.
                result = await exportChat(format, loader, readPrefs());
            } catch (err) {
                error = err;
            } finally {
                // Guaranteed: a throw mid-capture used to leave this overlay
                // pinned over the page with no way back except a reload. The
                // visibility listener rides on the same guarantee.
                loader.stopWatching();
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
            const skipped = s.artifacts
                ? '\n' + s.artifacts + ' artifact(s) or embedded view(s) were not exported; ' +
                  'each is marked in the file.'
                : '';
            // A complete capture closes, even when artifacts were skipped.
            // v5.1 held the dialog open to report them, and because the overlay
            // is hidden during the run, that reappearance read as the export
            // popping up a second time after the download. The file says it
            // loudly in its own header; the dialog does not need to.
            if (s.complete) {
                close();
            } else {
                status.style.color = '#9a6700';
                status.textContent = 'Downloaded ' + s.count + ' messages, but the capture may be incomplete:\n' +
                    s.reasons.join('; ') + '.\nThe file is flagged accordingly.' + skipped;
            }
        };

        mdBtn.addEventListener('click', () => run('markdown', mdBtn));
        htmlBtn.addEventListener('click', () => run('html', htmlBtn));
    }

    // -----------------------------------------------------------------------
    // In-page decorations
    //
    // A per-message Copy button used to be added here. It was removed in v4.2:
    // absolutely positioned at the message's top-right corner, it landed on the
    // first line of text on any turn that runs full width, and ChatGPT already
    // has native copy on both roles. Anchoring it also meant writing
    // style.position onto ChatGPT's own elements, which was the only place this
    // script mutated the site's DOM rather than adding to it.
    //
    // What is left is one fixed-position button of our own, so a refresh is a
    // single querySelector rather than a walk over every message on the page.
    // -----------------------------------------------------------------------

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
        if (onExcludedPath()) {
            // Covers arriving here by in-app navigation, where @exclude never
            // gets a second look because the document was never reloaded.
            const existing = document.querySelector('.export-chat-btn');
            if (existing) existing.remove();
            const open = document.querySelector('.export-modal-overlay');
            if (open) open.remove();
            return;
        }
        addExportButton();
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        if (window.requestIdleCallback) window.requestIdleCallback(refresh, { timeout: 600 });
        else setTimeout(refresh, 250);
    }

    // A host we have no adapter for gets nothing at all: no button, no
    // observer, no listeners. The @match lines should already prevent this,
    // but the script must not half-run if one is ever widened by accident.
    if (!SITE) return;

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    refresh();
})();
