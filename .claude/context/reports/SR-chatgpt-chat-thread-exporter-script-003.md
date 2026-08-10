**FOR CLAUDE.AI:** This is a status report generated inside Claude Code for the project below. Read it fully, update your stored memory for this project from Section 6, then reply with a short confirmation of what changed plus answers to any of Section 3's open questions you can address. Do not restate the report back to me. Treat Section 2 as current truth and anything you remembered previously as superseded.

---

```yaml
report_id: SR-chatgpt-chat-thread-exporter-script-003
project: Chat thread exporter (ChatGPT + Claude)
repo: https://github.com/Satejp10/Chatgpt-chat-thread-exporter-script
branch: claude/repo-overview-0t9niw
generated_utc: 2026-08-10T22:17Z
surface: claude code web
session_id: 838687e2-27fb-5348-a05e-007525f6e3ef
project_started: 2026-08-06
days_active: 5
total_commits: 34
commits_since_last_report: 23
previous_report: SR-chatgpt-chat-thread-exporter-script-002 (2026-08-10)
previous_report_delivered_to_chat: unknown
supersedes: SR-chatgpt-chat-thread-exporter-script-002
standalone: true
```

---

# TLDR

- **What:** A single-file userscript that exports a **ChatGPT or Claude** conversation to a local Markdown or self-contained HTML file, with zero network calls, so the user owns their archive without trusting vendor retention.
- **Status:** v5.6 on `main`, 14 PRs merged, working tree clean. Nine versions shipped since the last report. The user has paused work.
- **Changed since SR-002:** Claude support shipped behind a site-adapter layer. **Timestamps now work**, so SR-002's entire "why there are no timestamps" section is obsolete, delete it from memory. Four real bugs found from live exports and fixed, including one that silently deleted messages while claiming the export was complete.
- **Blocked:** Nothing. Every blocker named in SR-002 is resolved.
- **Next:** The user's call. The strongest candidate is a table-driven unit test on the date recogniser, since that one block has now shipped two bugs in consecutive sessions and has never had a test.
- **Needs a decision from you:** Whether `test/` gets repaired or deleted. It predates v5.0, some of it fails against the current script, and it has now missed four bugs in a row. Asked five times across sessions, never answered. It is the only real fork in the road.

---

# 1. Delta since SR-002

**Shipped:**

- **v5.0, claude.ai support** behind a site-adapter layer, plus markers for artifacts and embedded views. `[logged: 2026-08-10]`
- **v5.1, timestamps**, structural detection with no site selectors. `[logged: 2026-08-10]`
- **v5.2, duplicate-turn fix.** A real 14-message Claude thread was exporting as 29. `[logged: 2026-08-10]`
- **v5.3, per-role message counts** in both formats, hardened coding-surface exclusion. `[logged: 2026-08-10]`
- **v5.4, image-only turns no longer vanish**, plus mobile button placement. `[logged: 2026-08-10]`
- **v5.5 and v5.6, two independent bugs in the date recogniser**, both fixed. Timestamps are now confirmed working on the live site. `[verified: user report 2026-08-11]`
- **A `## Releases` section in the README** with a one-click install link pinned to a commit id. `[verified: README.md read this session]`

**Changed direction:**

- **The `@match` invariant was deliberately broken, once.** SR-002 lists "do not touch the `@match` lines, widening scope is a security regression" as absolute. `https://claude.ai/*` was added in v5.0, escalated in chat and requested by the user in as many words. The invariant still stands for every other host; this was the sanctioned exception, and it is recorded here so the next reader does not treat the code as a violation. `[logged: 2026-08-10]`
- **`@name` was changed** to *Chat Thread Exporter* in v5.0, knowingly forking the installed copy. It cost a round trip: the user reported the button appearing on `chatgpt.com/codex/cloud`, and the cause was a stale v4.2 entry installed alongside v5.x, not a code fault. New rule: do not rename `@name` again. `[logged: 2026-08-10]`
- **SR-002's central claim is retired.** Its §2.8, "Why there are no timestamps", said the feature was blocked on a live DOM sample in `docs/ref/` that had been requested since the handoff and never landed. That framing was wrong. No DOM sample was ever needed. The answer was to detect labels *structurally* (a `<time>` element, or any element whose entire trimmed text matches a date pattern), which requires knowing nothing about either site's markup. `docs/ref/` still does not exist and no longer matters. `[verified: script lines 300–400 read this session]`

**New problems, all found from real exports and all fixed:**

- **Duplicate turns (v5.2).** Identity used `domPath`, a positional index chain among siblings. Virtualization renumbers siblings constantly, so a remounted turn read as brand new. ChatGPT never exposed it because `data-message-id` always won; Claude has no id, so every turn took the positional path. A 14-message thread came out as 29, one turn appearing five times, and the file said `capture: complete`, which it was: nothing was missing, it was just repeated.
- **Silent message deletion (v5.4).** `IMG` sat in `SKIP_TAGS`, so a prompt that was only a screenshot produced no text, and a turn with no text was discarded. It was counted, a reason string was built, and the string was then never rendered, because reasons only print when the capture is incomplete and empty turns did not affect completeness. Present since v4.0. This is the exact failure the project exists to prevent.
- **Timestamps never matched anything (v5.5, v5.6).** Two independent gaps in one regex list, found in consecutive sessions from two different user exports. Detail in §2.8.

**Dropped / deferred:**

- The user's first sketch for timestamps, every message after a date separator inheriting that separator's label, was **declined and the user agreed**. Detail in §2.4.
- Emitting date separators as their own ordered entries between messages is **deferred, not declined**. It is the honest way to show grouping and needs `collect()` to walk in document order.

---

# 2. Full state (standalone)

## 2.1 What this is and why

A single-file userscript that scrapes the currently open **ChatGPT or Claude** conversation out of the DOM and downloads it as Markdown or a self-contained HTML file. It exists because the user wants a locally-owned archive of their chat history and does not trust vendor retention. That makes the exporter's own security posture the point of the project rather than a side concern: a tool built to escape a data-handling risk must not become one.

The second principle, which has driven nearly every bug fix since SR-002: **an archive that quietly drops or duplicates messages is worse than no archive.** Every export states what it knows it missed. Four of the last six versions were fixes to places where the file made a claim it could not support.

**What it must not become:** a rewrite. The instruction was to patch the script that exists.

**Hard constraints:**
- Single file. No build step, no bundler, no npm dependency in the script, no CDN link.
- Zero network calls from the script. No `fetch`, XHR, `sendBeacon`, WebSocket, image ping, or `@connect`.
- Zero credentials anywhere in the project.
- No telemetry, no analytics, no remote error reporting.
- No auto-update: `@downloadURL` / `@updateURL` deliberately absent, so the reviewed code cannot silently change under the user.
- Exported HTML must open offline as one self-contained file.
- Timestamps are never synthesized. An absent one means the field is omitted entirely, never `null`, never guessed.
- Non-goals: image and attachment *contents*, artifact *contents*, chat platforms beyond these two.

## 2.2 Timeline

- Started: 2026-08-06, commit `f4d3bb0` `[verified: facts block FIRST_COMMIT]`
- Working sessions logged: 15 (sessions 0 to 14) across 5 active days, 34 commits, 14 PRs merged `[verified: facts block; git log --merges; .claude/context/LOG.md]`
- 2026-08-06: project defined in chat; 12-point security audit of v3.0; v4.0 remediation and nav rail; report SR-001, delivered `[logged: 2026-08-06]`
- 2026-08-09: user confirms v4.0 on a real thread; v4.1 privacy toggles; v4.2 removes the injected Copy button `[logged: 2026-08-09]`
- 2026-08-10: report SR-002 `[logged: 2026-08-10]`
- 2026-08-10: **v5.0, claude.ai support** and artifact markers `[logged: 2026-08-10]`
- 2026-08-10: **v5.1, timestamps implemented**. The blocker SR-002 was built around dissolved `[logged: 2026-08-10]`
- 2026-08-10: **first real run of any version against a live site**, which immediately found the duplicate-turn bug; fixed as v5.2 `[logged: 2026-08-10]`
- 2026-08-10: v5.3 per-role counts; v5.4 image-only turns rescued and mobile placement `[logged: 2026-08-10]`
- 2026-08-10: v5.5 first timestamp pattern fix; README Releases section `[logged: 2026-08-10]`
- 2026-08-11: **v5.6, second timestamp pattern fix. User confirms timestamps work on the live site.** `[verified: user report this session]`
- This report: 2026-08-10T22:17Z

*(The 08-10 / 08-11 mixture is real: the facts block records the last commit as 2026-08-11 while the report generates at 2026-08-10T22:17Z. Local date and UTC straddle midnight.)*

## 2.3 Where the code is

**Stack:** Plain JavaScript in a Tampermonkey/Violentmonkey userscript, `@grant none`. No runtime dependencies, no build step. Tests are separate Node plus `playwright-core` tooling under `test/`. `[verified: metadata block read this session]`

**Entry point:** `ChatGPT Thread Exporter (Robust Auto-Scroll).user.js` at the repo root, **v5.6, 1771 lines, 83696 bytes (81.7 KB)**. `[verified: node --check → SYNTAX OK; wc -l -c]`

The filename still says "ChatGPT" and is deliberately unchanged; `test/` references it by that exact path.

**Working:**

- **Metadata intact where it matters.** `@namespace` unchanged, `@grant none`, no `@downloadURL` or `@updateURL`. `@match` covers `chatgpt.com`, `chat.openai.com` and `claude.ai`; six `@exclude` globs cover the coding surfaces. `[verified: read of lines 1–17 this session]`
- **No forbidden APIs.** `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `eval`, `new Function`, `GM_setValue`, `GM_xmlhttpRequest`, `document.cookie`, `downloadURL`, `updateURL` produce **exactly one hit** across 1771 lines, and it is the design-constraint comment on line 27. `innerHTML` appears twice, both comments (33, 1466). `localStorage` appears four times, all inside `loadPrefs`/`savePrefs` (464–499), nowhere near message content. `[verified: grep this session]`
- **Two sites behind one adapter layer.** `SITES` at line 69 holds `chatgpt` (71) and `claude` (92). A site contributes exactly four things: find message elements, tell whose turn it is, name the conversation, name the file. The scroller, DOM walker, both renderers, the nav rail and the modal are site-agnostic and were never touched by the port. `[verified: read this session]`
- **Claude uses a candidate-layout list** (`testid`, `msg-class`, `legacy` at lines 101–103) resolved against the live page, because it has no role attribute and its class names have changed more than once. When nothing matches, the export refuses and names the layout it tried. `[verified: read this session]`
- **Timestamps.** Confirmed working on chatgpt.com by the user on 2026-08-11: header label and per-turn times both appear. `[verified: user report this session]` Detail in §2.8.
- **Turn identity is content-based.** The site's message id where one exists, otherwise role plus the **full** text. A `WeakSet` of nodes sits in front of it. Every merge is counted and reported as `merged_duplicates`. Verified on real data: 18 articles, 18 unique, 9 user and 9 assistant, zero duplicates. `[logged: 2026-08-10]`
- **A dropped turn can no longer be silent.** `complete` now requires `!emptySkipped`, and the count is written to both formats as `turns_dropped_empty`. Images leave `> [image not exported: name]`, so an image-only turn has text and survives. `[logged: 2026-08-10]`
- **Per-role counts** in both formats, so a total that looks wrong can be checked against the number of prompts actually sent. `[logged: 2026-08-10]`
- **Mobile placement.** Below 820px the button docks to the middle of the right edge, computed in JS off `innerWidth` rather than a media query, because a `<style>` element would depend on the host page's CSP allowing inline stylesheets. `[logged: 2026-08-10]`
- Everything carried from v4.x still holds: capture completeness flags with reasons, the two privacy toggles, `createElement`-only UI, `default-src 'none'` on exported HTML, HTML-escaped content, `https:`/`mailto:` links only. `[logged: 2026-08-06, 2026-08-09]`

**Broken or incomplete:**

- **Claude artifact selectors have never matched anything.** All three are unverified guesses. Every placeholder that has ever appeared in a real export came from the generic `IFRAME` fallback, labelled "embedded view". The hedge worked; the guesses did not. Real selectors are still unknown and need the `outerHTML` of one artifact card. `[logged: 2026-08-10]`
- **Artifacts leave no trace when the connector is mid-render.** One export marked three artifacts; the next marked zero, because the MindMap connector was still showing "Connecting to MindMap…" and no iframe existed yet. The exporter recorded what was on screen, which is correct behaviour, but the practical result is that the mindmaps vanished without a marker. `[logged: 2026-08-10]`
- **`test/` predates v5.0.** It still asserts the old `chatgpt-export-` filename prefix (`test/e2e.test.js:118`) and the old `generator: ChatGPT Thread Exporter` line, so parts of it fail against the current script. There is no Claude fixture, no image-only-turn fixture and no timestamp fixture. It has now missed four consecutive real bugs. `[verified: grep of test/*.js this session]`
- **No tag and no GitHub Release exists** for any version. The session's git proxy returns HTTP 403 on a tag push, so creating one is a web-UI action for the user. `[logged: 2026-08-10]`
- **No `CLAUDE.md`.** The conventions in §2.6 live only in these reports and in `LOG.md`. `[verified: ls this session]`
- **Whether claude.ai renders a timestamp the recogniser can see is untested.** The recogniser is site-agnostic so it costs nothing either way, and it fails silently by design. `[unverified]`

**Uncommitted work in progress:** clean tree. `.claude/context/LOG.md` and this report are the only changes, committed together with it. `[verified: git status]`

## 2.4 Decisions

Carried forward from SR-002 and still in force: audit before features; stall-counter capture exit; completeness flag with reasons; DOM walker instead of `innerText`; `createElement` never `innerHTML`; the nav rail *is* the no-JS fallback; `default-src 'none'` in exports; comparison tests pin an explicit git ref never `HEAD`; two privacy toggles; withheld means omitted; `localStorage` for preferences only, read back as untrusted input; the injected Copy button stays removed.

New since SR-002:

| Decision | Date | Why | Rejected | Reversible? |
|---|---|---|---|---|
| A site contributes exactly four things; everything else stays site-agnostic | 2026-08-10 | ChatGPT's coupling turned out to be five identifiers across 1132 lines. Nothing else knew what site it was on, so the port is additive rather than a rewrite | Forking the script per site | Cheap |
| Claude gets a *list* of candidate layouts, first match wins and is cached | 2026-08-10 | It has no role attribute and its class names have changed more than once. A layout matching one role is used but not cached, since a new chat legitimately shows one role | A single selector, which breaks silently | Cheap |
| When nothing matches, refuse and name the layout tried | 2026-08-10 | A silently empty file is the failure mode this project exists to avoid. The refusal message *is* the bug report | Exporting an empty file | Locked in |
| Artifacts and images are marked, not exported | 2026-08-10 | Same doctrine as the capture flag: the file states what is missing. `> [artifact not exported: name]` plus a count in the header | Exporting artifact source (needs the CSP question answered first); clicking each card open (a second scroll-and-settle problem) | Cheap |
| Artifact count is reported separately from the capture flag | 2026-08-10 | They mean different things. Truncated = the exporter does not know what it missed. Marked = it knows exactly what it missed and where | One combined number | Locked in |
| **Transcribe, never resolve.** A label reading `Yesterday 8:30 PM` is exported as that literal string | 2026-08-10 | Turning it into a date means computing it against the capture time, and a computed timestamp is one the page never showed. The absolute export time sits directly above it, so anchoring it is a subtraction the reader can do and verify | Resolving relative labels to ISO dates | Locked in, it is the invariant |
| **Detect date labels structurally, not by selector** | 2026-08-10 | A `<time>` element wins outright; otherwise an element whose *entire* trimmed text matches a date pattern and is under 48 characters. This contains no chatgpt.com or claude.ai selectors at all, so it cannot break on a renderer change, and it is why the feature could be built with no DOM sample, after five sessions of waiting for one | Selector-based detection, which is what sessions 1–5 assumed was required | Locked in |
| Search a bounded neighbourhood: 6 previous siblings across 8 ancestor levels, stopping dead at the previous turn | 2026-08-10 | Unbounded search eventually finds an unrelated date elsewhere on the page and staples it to the wrong message, which is worse than reporting nothing | An unbounded walk | Cheap |
| **A turn with no rendered label gets no timestamp and never inherits the one above it** | 2026-08-10 | "The page showed nothing here" and "the page showed the same thing here" are different claims, and only one is true | The user's own first sketch, an active-date model where messages inherit the last separator. Declined: `Wed, Jul 29 at 8:24 AM` carries a *clock*, so stamping it on the fourth turn asserts a time the page never showed. The user agreed | Locked in, it is the invariant |
| Identity is the site's message id, else role plus the **full** text | 2026-08-10 | Positional keys break under virtualization: a remounted turn lands at a different index and reads as new. A 50-char prefix was tried in v4.0 and merged genuinely distinct short turns | `domPath`; a text prefix | Locked in |
| Every merge is counted and written into the export | 2026-08-10 | Content identity can over-merge two byte-identical turns. The residual risk is made visible rather than eliminated | Silent merging | Locked in |
| Do NOT emit a placeholder for turns still empty after image rescue | 2026-08-10 | A placeholder needs a dedup key, and the only key available on a site with no message ids is the text, which is exactly what an empty turn does not have. That is the shape of the v5.2 bug. Counting them is honest; inventing keys for them is how the duplicate bug comes back | A generic `[empty turn]` marker | Cheap |
| `complete` requires `!emptySkipped` | 2026-08-10 | A file that dropped a turn can no longer claim it is complete. This was being violated by an accounting gap, not a missing feature | Reporting the count without affecting the flag | Locked in |
| Compute mobile placement in JS off `innerWidth`, not a media query | 2026-08-10 | The style is an inline attribute; a `<style>` element would depend on the host page's CSP allowing inline stylesheets, and that is not a bet worth making on these two hosts | A CSS media query | Cheap |
| Exclude the coding surfaces in metadata **and** at runtime | 2026-08-10 | `@exclude` alone is insufficient: both sites are single-page apps, so navigating from a chat to `/code` or `/codex` never reloads the document. The guard also sits inside `addExportButton()` itself, the only function that injects the button | Metadata excludes only | Cheap |
| **Do not rename `@name` again** | 2026-08-10 | The v5.0 rename forked the install and cost a round trip diagnosing a bug report against correct code. A README note is not a mitigation, because the person who needs it has already installed. If identity must change, the delete-the-old-entry step goes at the *top* of the release notes | Another rename | Locked in |
| The README download link is pinned to a **commit id**, not to `main` | 2026-08-10 | A raw URL on `main` changes whenever `main` changes, which contradicts the promise the README already makes: the file you reviewed is the file that runs. Cost: every version bump needs the link repointed, in a follow-up commit, since a commit cannot contain its own sha | A `main` URL; a release asset, which is a second source of truth that can drift | Cheap |
| No release asset even once tagging is possible | 2026-08-10 | One file, one copy. An uploaded userscript can drift from the file in the repo | Attaching the `.user.js` to a Release | Cheap |

## 2.5 Dead ends

- **Full API-first rewrite** rejected 2026-08-06 because the user judged it over-engineered. The instruction is to patch the script that exists. Do not retry.
- **Auto-update via `@downloadURL` / `@updateURL`** removed before this work started and must not be reintroduced. Do not retry.
- **The authenticated conversation API as a timestamp source** escalated and declined 2026-08-06, restated 2026-08-10, because it adds an authenticated network call to a tool whose entire promise is that it makes none. Do not retry without the user reversing the no-network constraint in as many words.
- **`git show HEAD:` as a test baseline** produced a false pass on the headline security finding: once the audit commit landed, `HEAD` *was* the new version, so the test compared v4.0 against itself and reported both sides clean. Fixed to `BASELINE_REF` (default `5405be1`).
- **`GM_setValue` for preferences** rejected 2026-08-09: it requires changing `@grant none` and moves the whole script into the manager's sandbox context, a behaviour change across everything for one boolean.
- **`domPath`, a positional dedup key**, abandoned 2026-08-10. It turned a real 14-message Claude thread into a 29-message export. Do not reintroduce any identity scheme based on DOM position; virtualization renumbers siblings constantly.
- **A text *prefix* as a dedup key** tried in v4.0 and abandoned: 50 characters merged genuinely distinct short turns. Full text or nothing.
- **Waiting for a live DOM sample in `docs/ref/` before building timestamps**: five sessions of blockage on an artefact that was never required. The right move was to detect structurally rather than by selector. Recorded as a dead end so the pattern is recognised next time: *when a feature is blocked on someone else's markup, check first whether the feature can be written to not care about markup.*
- **An active-date inheritance model for timestamps** declined 2026-08-11 with the user's agreement; see §2.4.
- **`git tag -a v5.5 && git push origin v5.5`** returns HTTP 403 from this session's git proxy, which allows pushes to the designated branch only. Tags cannot be created from Claude Code here. Do not retry; it is a web-UI action for the user.

## 2.6 Invariants (do not break)

- Do not change `@namespace`. Changing it forks the user's already-installed copy.
- **Do not rename `@name`.** Same forking hazard; it already cost a round trip once.
- Do not widen `@match` further. `claude.ai` was added in v5.0 as an explicit, escalated, user-requested exception. Any further host is a decision to escalate, not a thing to just do.
- Do not reintroduce `@downloadURL` or `@updateURL`.
- No network calls from the script or from an exported file, for any reason, including cosmetic ones.
- Never assign to `innerHTML`, in the script or in the export's inline JS.
- **Never synthesize a timestamp.** Absent means the field is omitted, not `null`, not inferred, and never inherited from an adjacent turn.
- A withheld field is omitted entirely, never blanked, never `null`.
- Nothing from a conversation is ever persisted. The only stored value is the two-boolean export preference under `cge-export-prefs`, read back as untrusted input.
- Do not write to the host site's own elements. The script adds exactly one element of its own, the Export Chat button.
- **Never let an export claim `complete` when anything was dropped.** Every omission is counted and printed.
- **Never use a dedup key that depends on DOM position.**
- Zero credentials in this repo, ever.
- The userscript stays one file with no build step and no dependencies. `test/` is separate tooling and ships with nothing.
- Any comparison test pins an explicit git ref, never `HEAD`.
- Reporting style the user has asked for: TLDR at the bottom of substantive replies, recommendation first when presenting a choice (never a neutral menu), overhead flagged unprompted with the number attached, terse, simple language, no em dashes.
- The user runs the tests. Claude Code does static checks only unless told otherwise.

## 2.7 Known issues and debt

- **`test/` is stale and has now missed four consecutive real bugs**: the duplicate turns, the image-only drop, and both timestamp pattern failures. The fixture does not remount turns, has no image-only turn, has no Claude markup and has no date label. Both timestamp bugs were pure-function failures that one table-driven unit test would have caught in seconds. This is the single largest piece of debt in the project.
- Script size has grown 12.7 KB (v3.0) → 51.0 (v4.2) → **81.7 KB** (v5.6). `[verified: wc -c this session]` The growth since SR-002 is claude.ai support, artifact and image markers, the timestamp block and the mobile placement logic.
- The nav rail costs 27.4 KB on a 284.7 KB / 300-message export, which is 9.6%. Deliberate and accepted; it adds zero site selectors. `[logged: 2026-08-06]`
- Every version bump requires repointing the README download link at a new commit, in a follow-up commit. Intended cost of pinning.
- No `CLAUDE.md`. Asked five times across sessions, never answered; the ask was dropped.
- `docs/ref/` never existed and is no longer needed.
- HANDOFF.md was never committed. `.claude/context/LOG.md` is the durable record.
- Exported Claude artifact placeholders are preceded by the literal text "MindMap MindMap" from the tool-use header and card label. Cosmetic, left alone.
- A third-party audit of the repo was run by the user on 2026-08-10. It is accurate on architecture but quotes v5.3 behaviour that v5.4 had already changed hours earlier. Its remaining substantive points (canonical message identity, ordering reconciliation, Claude fixtures) are real; identity is now addressed, the other two are not.

## 2.8 Timestamps: how they actually work

**This section replaces SR-002 §2.8 entirely. That section explained why timestamps could not be built. They are built, and they work.**

**State:** shipped in v5.1, fixed in v5.5 and v5.6, confirmed working on chatgpt.com by the user on 2026-08-11. The header label and the per-turn times both appear. `[verified: user report this session]`

**How it works:**

1. A `<time>` element wins outright: its text is the shown value, its `datetime` attribute the exact one.
2. Otherwise, an element whose **entire** trimmed text matches one of six date/time patterns and is under 48 characters is treated as a date separator. A `title` attribute on it, if present, is copied as the exact value.
3. For each turn, `findTimeFor()` walks 6 previous siblings across 8 ancestor levels and **stops dead** on reaching the previous turn.
4. The label is read on **first sight** of a turn, inside `collect()`, because the neighbourhood is still mounted then. After the scroller moves past, virtualization may have removed it.
5. `exact` is copied, never parsed. A malformed attribute is the page's statement; rewriting it would be synthesis by another route.

It lands as `started_label` / `started_exact` in the Markdown frontmatter, a *Thread starts* line in the HTML header, `timestamped_messages` as a count, and a small time beside each turn with `title` carrying the exact value.

**Why it took nine versions and two bug fixes:**

The feature was written in v5.1 and **did not work at all** until v5.6. Nobody knew, because every field is suppressed when falsy, and a recogniser that matches nothing produces an export that looks exactly like a thread with no dates on it.

- **v5.5.** The `AT` token, the join between a date and a clock, was `(?:\s*(?:at|,)\s*)?`: the whole group optional but `at` or `,` mandatory *inside* it. Against `Today 7:58 AM` the group matched empty, `CLOCK` then faced a leading space, and the match died. Date-space-clock, the form both sites actually render, was the one shape excluded. Fixed to `(?:\s*(?:at|,)?\s*)?`.
- **v5.6.** There was a pattern for a weekday alone (`Monday 9:15 AM`) and a pattern for a month-day alone (`Jul 29 at 8:24 AM`), and nothing for the two together. `Wed, Jul 29 at 8:24 AM`, the form chatgpt.com renders at the top of a thread, was the one form with no pattern. Fixed with an optional `DOW` weekday prefix, with month-first and day-first merged into one pattern so the prefix cannot drift between two copies.

**Both bugs sat under a comment whose own example the code beneath it rejected.** v5.5's comment cited `Yesterday 8:30 PM`; v5.6's cited `Wednesday, September 10, 2026 at 11:45 PM`. In both cases the example was written from the page and the regex was written separately, and nobody checked one against the other. The lesson is not "write better comments". It is that **this block has no test and every check of it has been manual.**

Both bugs were diagnosed from the user's own exports, with no DOM sample, by executing the live patterns straight out of the source file. v5.6 was verified against a 28-case accept/reject matrix, 18 accept and 10 reject, all passing. The rejects include `Wed, Jul 29 at 8:24 AM and then everything broke`, which is the widening risk in its most direct form and is caught by the closing anchor.

**What bounds the risk:** the `^…$` anchors, the 48-character cap, and the rule that the element's whole flattened text must match. Prose that opens with a date word still fails at the closing anchor.

---

# 3. Open questions for you

1. **Does `test/` get repaired or deleted?** It predates v5.0, some assertions fail against the current script, and it has missed four consecutive real bugs. Asked five times and never answered. Recommendation: repair it, starting with one table-driven unit test on `looksLikeTimeLabel()`. That is a few dozen lines and covers the block that has now shipped two bugs in a row. Blocking nothing, but it is the reason bugs keep reaching you instead of being caught here.
2. **Can you paste the `outerHTML` of one Claude artifact card?** All three artifact selectors are guesses and none has ever matched; only the generic iframe fallback works. Ten seconds on the live page, and it is the only thing blocking real artifact detection.
3. **Do you want date separators emitted as their own rows** between messages, showing day grouping without stamping a time on any individual turn? Deferred from v5.6, and it is the honest version of the inheritance model we declined.
4. **Do you want a `v5.6` tag and a GitHub Release?** I cannot create either, because the proxy returns 403 on a tag push. It is two clicks in the GitHub UI, and it would let the download link be a readable tag URL instead of a commit sha.
5. **Should the conventions in §2.6 move into a `CLAUDE.md`?** Asked five times, never answered; the ask was dropped. They currently live only in these reports and in `LOG.md`.

---

# 4. Next actions

Nothing is in flight and the user has paused. In priority order when work resumes:

1. **One table-driven unit test on the date recogniser.** Acceptance: a test file that runs the accept/reject matrix from §2.8 against `looksLikeTimeLabel()` extracted through the existing `test/harness.js`, and fails if any case regresses. This is first because it is small and it closes the exact hole that let two bugs reach the user.
2. **Repair the rest of `test/`,** or delete it. Acceptance: `cd test && npm test` passes against v5.6, or the directory is gone and the README's Tests section with it. Either is better than a suite that fails for stale reasons and is therefore never run.
3. **Date separators as their own ordered rows.** Acceptance: `collect()` walks the container in document order, and an export of a multi-day thread shows the separator between the correct turns without any turn inheriting a time. Needs question 3 answered.
4. **Claude artifact selectors.** Acceptance: an export of a thread with an artifact marks it by name rather than as a generic "embedded view". Needs question 2 answered.

---

# 5. Verification ledger

**Ran this session:**
- `node --check "ChatGPT Thread Exporter (Robust Auto-Scroll).user.js"` → SYNTAX OK
- `wc -l -c` → 1771 lines, 83696 bytes
- read of the metadata block → v5.6, `@namespace` unchanged, three `@match` hosts, six `@exclude` globs, `@grant none`, no `@downloadURL` / `@updateURL`
- `grep -nE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket|eval\(|new Function|GM_setValue|GM_xmlhttpRequest|document\.cookie|downloadURL|updateURL"` → one hit, the design-constraint comment on line 27
- `grep -n "innerHTML"` → two hits, both comments
- `grep -n "localStorage"` → four hits, all in `loadPrefs`/`savePrefs`
- `grep -n "TIME_LABEL_RES|looksLikeTimeLabel|findTimeFor|started_label|timestamped"` → the timestamp implementation is present at 316, 342, 379, 876, 960, 1005, 1008
- `grep -n "const SITES|id: 'chatgpt'|id: 'claude'"` → adapters at 69, 71, 92; Claude candidate layouts at 101–103
- `grep -rn "chatgpt-export|ChatGPT Thread Exporter" test/*.js` → `e2e.test.js:118` still asserts the pre-v5.0 filename prefix
- `ls docs` → no such directory · `ls CLAUDE.md` → no such file
- `git log --merges | wc -l` → 15 · `git status` → clean · `main` and the working branch both at `1f883e0`

**Read this session:** `.claude/context/LOG.md` (all 15 sessions), `.claude/context/reports/SR-...-002.md`, `README.md`, the userscript metadata and timestamp blocks, git history.

**Not verified:**
- **The test suite was not run,** at the user's standing instruction that they run tests themselves. The last recorded counts are 79 unit and 44 e2e assertions `[logged: 2026-08-09]`, and parts of the suite are known to fail against v5.6 for stale reasons. Run with `cd test && npm test`.
- Script size in KB is from `wc -c`; render times and export sizes are carried from 2026-08-06 and were not re-measured.
- Whether claude.ai renders a date label the recogniser can see. Untested on that site.
- Whether the timestamp feature behaves on a multi-day thread with several separators. The user's confirmation was on a thread with a header date and per-turn times.
- Anything about the live DOM of either site beyond what the user has reported. No browser session against either.
- Behaviour in Violentmonkey. Only Tampermonkey semantics have been reasoned about.

---

# 6. Memory block (for Claude.ai to store)

**Retire these stored facts from SR-002; they are now false:**
- ~~"Timestamps have never been implemented."~~ They are implemented, shipped in v5.1, fixed in v5.5 and v5.6, and confirmed working on the live site 2026-08-11.
- ~~"Blocked on a live DOM sample in `docs/ref/`."~~ No DOM sample was ever needed. The feature was built by detecting date labels structurally rather than by selector.
- ~~"The project is ChatGPT-only."~~ It supports ChatGPT and Claude.
- ~~"Never touch the `@match` lines."~~ Still true for new hosts, but `claude.ai` was deliberately added in v5.0 at the user's explicit request.
- ~~"v4.2, 51.0 KB, 1132 lines."~~ Now v5.6, 81.7 KB, 1771 lines.

**Current facts:**
- Chat thread exporter is a single-file Tampermonkey/Violentmonkey userscript that exports a **ChatGPT or Claude** conversation to local Markdown or self-contained HTML, at https://github.com/Satejp10/Chatgpt-chat-thread-exporter-script. No deploy target: it runs in the user's browser.
- Stack: plain JavaScript userscript, `@grant none`, zero runtime dependencies, no build step. Tests are separate Node plus playwright-core tooling under `test/`.
- Started 2026-08-06; currently v5.6, 1771 lines, 81.7 KB, 34 commits, 14 PRs merged, working tree clean.
- Purpose: the user wants a locally-owned archive because they do not trust vendor retention, so the exporter's own security posture is the point of the project.
- Second principle: an archive that quietly drops or duplicates messages is worse than no archive. Every export prints what it knows it missed.
- Architecture: a `SITES` adapter list. A site contributes only four things: find message elements, tell whose turn it is, name the conversation, name the file. The scroller, DOM walker, both renderers, nav rail and modal are site-agnostic.
- Claude has no role attribute, so it uses a list of candidate layouts resolved against the live page; when none match the export refuses and names the layout it tried.
- Decided: **transcribe timestamps, never resolve them.** `Yesterday 8:30 PM` exports as that literal string, because computing a date from it is a timestamp the page never showed.
- Decided: **detect date labels structurally, not by selector**: a `<time>` element, or any element whose entire trimmed text matches a date pattern under 48 characters. This is why the feature needed no DOM sample and cannot break on a site redesign.
- Decided: a turn with no rendered label gets no timestamp and never inherits one from the turn above. An inheritance model was proposed by the user and declined with their agreement, because the label carries a clock and stamping it on a later turn asserts a time the page never showed.
- Decided: turn identity is the site's message id, else role plus the **full** text. Never DOM position (it broke as v5.2: a 14-message Claude thread exported as 29), never a text prefix (tried in v4.0, merged distinct short turns).
- Decided: `capture: complete` requires that nothing was dropped, including empty turns. Images leave a marker so an image-only prompt survives.
- Decided: artifacts and images are marked with a named placeholder and counted, never exported.
- Decided: the README download link is pinned to a commit sha, not `main`, so the file cannot change after review. No release asset, because it is a second source of truth that can drift.
- Decided: do not rename `@name` again. The v5.0 rename forked installs and cost a round trip diagnosing a bug report against correct code.
- Constraint: never change `@namespace`; do not widen `@match` beyond the three current hosts without escalating.
- Constraint: zero network calls from the script or an exported file, zero credentials in the repo, no telemetry, no auto-update, no build step, no dependencies.
- Constraint: never assign to `innerHTML`; never synthesize a timestamp; a withheld field is omitted entirely rather than blanked.
- Constraint: the user runs the tests. Claude Code does static checks only unless told otherwise.
- Constraint: reports use a TLDR at the bottom, lead with a labelled recommendation rather than a neutral menu, flag overhead unprompted with the number attached, stay terse, use simple language, and no em dashes.
- Do not: propose a full API-first rewrite; rejected as over-engineered, the instruction is to patch the script that exists.
- Do not: reintroduce `@downloadURL` / `@updateURL`.
- Do not: use the authenticated conversation API for timestamps; escalated and declined twice, because it adds a network call to a tool whose promise is that it makes none.
- Do not: use any dedup key based on DOM position.
- Known debt: `test/` predates v5.0, some assertions fail against the current script, and it has missed four consecutive real bugs. Both timestamp bugs were pure-function failures one table-driven unit test would have caught.
- Known gap: all three Claude artifact selectors are guesses and none has ever matched; only the generic iframe fallback works. Needs the `outerHTML` of one artifact card from the user.
- Known gap: artifacts leave no marker at all if the connector is still rendering when the export runs.
- No git tag and no GitHub Release exists for any version; the session's git proxy returns HTTP 403 on tag pushes, so that is a user action in the GitHub UI.
- Currently blocked on: nothing. The user paused work after confirming v5.6 timestamps work.
- Next: a table-driven unit test on the date recogniser, then repair or delete the rest of `test/`.

---

# 7. Appendix

**File inventory:**
- `ChatGPT Thread Exporter (Robust Auto-Scroll).user.js`: the entire product, v5.6, 1771 lines. Filename deliberately unchanged despite covering two sites; `test/` references it by that exact path: shipped
- `README.md`: install, Releases with the pinned download link, the four guarantees, capture semantics, timestamps, artifacts, dropped turns, duplicates, site support, mobile: current
- `.claude/context/LOG.md`: append-only session history, sessions 0 to 15: current
- `.claude/context/reports/`: status reports 001, 002, 003
- `test/*`: unit, e2e, Trusted Types and measurement tooling. Predates v5.0, partly failing, no Claude / image-only / timestamp fixtures: stale

**Commands:** build: none by design · test: `cd test && npm install && npm test` · measure: `cd test && npm run measure` · run: install the `.user.js` in Tampermonkey or Violentmonkey, then click **Export Chat** on `chatgpt.com` or `claude.ai`

**Environment:** Node 22.x, `playwright-core` as the only devDependency, system Chromium located automatically or via `CHROMIUM_PATH`. The userscript requires no environment variables. `BASELINE_REF` optionally overrides the git ref the tests compare against.

**Recent commits:**
- `1f883e0` Merge pull request #14
- `e62b706` README: point the download link at v5.6
- `6be8b12` v5.6: recognise the weekday-plus-date form ChatGPT actually renders
- `72df69d` Merge pull request #13
- `fcc3dbf` README: add a Releases section with a pinned download link
- `5df7007` Merge pull request #12
- `7e52b62` v5.5: fix the timestamp patterns, which never matched a real label
- `3532d76` v5.4: stop dropping image-only turns, and fix the button on mobile
- `a7882ac` Log: codex/cloud button was a stale v4.2 install, not a code fault
- `8432a16` Report message counts per role, harden coding-surface exclusion (v5.3)
- `b0d1d55` Fix duplicate turns, dialog reappearing, and coding-surface scope (v5.2)
- `5ce70b3` Capture rendered timestamps, and ask users to pre-scroll (v5.1)

**Note on install:** there is no auto-update by design. v5.6 requires clicking the download link in the README's Releases section and confirming the install prompt. The version currently running is whatever was last installed.
