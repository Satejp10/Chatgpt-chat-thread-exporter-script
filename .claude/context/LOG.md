# Project log: ChatGPT chat exporter

Append-only. Newest entries at the bottom. Never edit or delete a past entry;
corrections go in a new entry as `- correction: ...`.
One entry per working session. `/project-status` builds its reports from this file
plus live git facts, so anything not written here is likely to be lost.

Entry format:

## YYYY-MM-DD | session N | <cli | web | desktop>
- did: <what actually changed>
- decided: <decision> because <reason>
- rejected: <alternative> because <reason>
- broke/fixed: <symptom, and resolution if any>
- open: <unresolved question>
- next: <intended next action>

---

## 2026-08-06 | session 0 | chat
- did: project defined in Claude.ai; HANDOFF.md written (HO-chatgpt-exporter-001)
- decided: audit before features, because a security patch after a feature change is harder to isolate
- decided: anchor nav lives in the exported HTML, not the live site, because the exports are what is hard to navigate
- decided: timestamps are captured only when the page renders them, never synthesized
- rejected: full API-first rewrite, because the user judged it over-engineered for the need
- open: does the script still cover platforms other than ChatGPT; which timestamp source exists today
- next: produce the 12-point security and correctness audit, then stop for approval

## 2026-08-06 | session 1 | web
- did: 12-point audit of v3.0 (300 lines), then implemented the approved remediation and the nav rail as v4.0
- did: added `test/` with unit, end-to-end (headless Chromium) and Trusted Types suites, plus a size/runtime measurement script
- found: HANDOFF.md, docs/ref/ screenshots, the live DOM sample, CLAUDE.md and .claude/ were never committed; repo held only the userscript and a stub README
- found: script is ChatGPT-only, so the session-0 open question about Gemini/Grok/Claude coverage is closed — no shared paths to protect
- found: no network calls, no eval, no persistence, no credentials, no auto-update anywhere in v3.0 — clean on the exfiltration axis
- correction to session 0 hypothesis (a): there was no permissive Trusted Types policy. The real problem was the inverse — two static `innerHTML` writes that *throw* under `require-trusted-types-for 'script'`, breaking the export UI entirely. Reproduced in Chromium: v3.0 modal unusable, v4.0 fine.
- correction to the audit's own priority ordering: HTML escaping was flagged in HANDOFF §8 as the top risk and likely broken. It was adequate — message text lands in a text node, where escaping `&`/`<`/`>` is sufficient. The Markdown export was the one with a real delimiter problem.
- confirmed session 0 hypothesis (b): virtualization loss is real. Measured against a synthetic 120-message lazy-loading thread: v3.0 captured 60 of 120 and reported nothing wrong. v4.0 captures 120 of 120.
- decided: capture ends on a stall counter (3 consecutive zero-yield passes at the bottom) rather than a scroll-position delta, because one non-moving scroll step used to end the whole capture — and that is most likely exactly while older turns are loading
- decided: seek to the top in a loop until height and message count stop growing, because a single `scrollTop = 0` only reaches the top of what is currently mounted
- decided: every export carries a `capture: complete | possibly-truncated` flag with reasons, because silent incompleteness is the failure mode that matters for an archive
- decided: replaced `innerText` extraction with a DOM walker emitting Markdown, because `innerText` is layout-aware (drops collapsed content) and discarded every link URL and code fence
- decided: the nav rail *is* the no-JS fallback — one `<nav>` of real anchors, restyled into a rail by a `html.js` class — rather than HANDOFF's separate collapsed anchor list, because two copies cost ~13 KB and gave nothing back
- decided: added a CSP meta tag to the exported HTML (`default-src 'none'`), because it makes exfiltration from an export structurally impossible for ~150 bytes
- decided: committed a test suite despite the plan saying none was proposed, because it caught two real bugs the code review did not
- rejected: the authenticated conversation API as a timestamp source, because it adds a network call to a tool whose whole promise is that it makes none
- broke/fixed: the fixed rail swallowed pointer events across a 40px strip of the export, including its own toggle. Fixed with `pointer-events: none` on the nav, `auto` on the list.
- broke/fixed: rail tooltips were clipped to 40px because `overflow-y: auto` forces `overflow-x: auto`. Fixed by moving to one shared tooltip element outside the scroll container.
- measured: rail costs 27.4 KB on a 300-message export (284.7 KB total), 9.6%, and depends on zero new chatgpt.com selectors
- open: timestamps are still not implemented — blocked on a live DOM sample in docs/ref/ that was never committed
- open: whether chatgpt.com currently enforces Trusted Types in production (the fix is in either way)
- open: real-world verification on a long thread with the script installed; everything here was verified against a synthetic fixture
- next: user installs v4.0 and exercises it on a real long thread; timestamps only after a DOM sample lands
