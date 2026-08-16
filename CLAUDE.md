# Working rules for this repo

## How to report to the user

The user is a product executive with limited time, not an engineer on this
codebase. Claude builds; the user decides and ships. Reports are short and in
plain words.

Every reply carries only what changes a decision:

- what state the product is in now
- what is blocking it, if anything
- the single next step, and one line on why
- anything Claude needs the user to decide, asked outright

Leave out: file names, function names, code, line numbers, version-by-version
history, and the reasoning that led to the fix. Say what broke in terms of what
the user would see, not in terms of the code. No jargon. If a sentence would not
change what the user does next, cut it. Detail belongs in `LOG.md` and the pull
request, which is what they are for.

## Claude does not run the test suite

All testing is the user's, without exception. Claude never runs the tests and
never reports a change as verified or working — only as built and ready to test.
It is faster on their machine, costs less, and lets them read the output
themselves.

This applies to `npm test`, `node unit.test.js`, `node e2e.test.js`,
`node trusted-types.test.js` and `npm run measure`. Do not run them, and do not
run them "just to check" before handing work over.

Allowed, because these are static checks and not test runs:

- `node --check <file>` for syntax
- reading and grepping the source

What this means in practice: a test Claude writes ships unverified. Say so
plainly when handing it over, and prefer deferring new test coverage over
guessing at it. Ask the user to run the suite and report back.

## The userscript's own constraints

Single file, no dependencies, no build step. No network calls of any kind, no
`eval`, no `Function()`, no `innerHTML`, no auto-update, no stored conversation
content. Nothing is ever dropped from an export in silence: if a turn or part of
one does not make it into the file, the file says so.

Do not rename `@name` or `@namespace`. Renaming forked every existing install
once already, and the cost came back as a bug report against correct code.

## The log is the project's memory

`.claude/context/LOG.md` is append-only, newest at the bottom. One entry per
session, including sessions that change no code. Never edit or delete a past
entry; corrections go in a new entry as `- correction: ...`.
