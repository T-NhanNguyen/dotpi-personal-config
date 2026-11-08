---
name: Files Writing Style
description: Rewrite prose (docs, PRs, reports, error messages, never code) so it reads clearly on the first pass. Use when asked to make writing sound less like AI.
placement: append
order: 5
---

# human-writing

Rewrite any prose into a two-layered structure, ASD-STE100 Simplified Technical English, and clear, mapped-out text. The bar: the reader infers and comprehends it on the first read, builds one clear mental model, and never re-reads a sentence to parse it.

Applies to any prose. Never code, identifiers, or command syntax. Not for marketing copy.

## Rules

SENTENCES
- Complete, plain sentences. No em-dash staccato, no rhetorical fragments, no staccato triads. That cadence forces re-reading and is a known AI tell.
- The em dash is banned. Use periods and commas.
- One idea per sentence. Short sentences — around 25 words. A longer one is fine only as a clean parallel list of concrete specifics, not stacked clauses.
- No semicolons. Write two sentences.
- Active voice with the actor named. "the parser reads the file", not "the file is read by the parser".
- No stacked auxiliaries. Not "it is important to note that this may help to improve". Say what is, or cut the sentence.

WORDS
- Concrete specifics instead of adjectives. Delete words that claim quality (seamless, robust, powerful, cutting-edge, effortless, world-class, revolutionary, next-generation). Replace with the detail that earns the claim, or cut the word. ("impactful and valuable" became the actual specs.)
- One name for one thing. Do not call the same item by two different names.
- No sprint to acronyms. Never let opaque IDs and shorthand carry the meaning. Translate every piece of jargon into the plain action or thing it stands for.
  - Bare test IDs mean nothing on their own. Not "Run B1 and P1 through the test gate." Say what B1 and P1 are and what the gate does to them.
  - Prefer verb-first plain English over noun-stack labels. "Confirm the debug path before you touch hardware" beats "Revalidate probe liveness, halt state, and ownership."
  - Prefer what-it-is phrasing over feature names. "Image that is ready to test real handoff on hardware" beats "opt-in dispatch image."
  - If a label must stay (a real test name, config flag, or trace id), gloss it once in plain words on first use, then use the short name: "the checked-handoff run (the test that proves the handoff works), here called P8." Never open with the bare label.
  - One stacked noun phrase per sentence at most. Split chains like "compiled-handoff oracle with strict ordering and retained watchdog preservation" into separate short sentences, each naming one thing that happens.
- Short common word where it does not flatten meaning: start (not commence/initiate), use (not utilize/leverage), help (not facilitate), make sure (not ensure), before (not prior to), after (not subsequent to), about (not regarding/concerning), get (not obtain/acquire), show (not demonstrate).
- Use time markers to point at the step that did the work. Words like already, before, after, by the time, first, and then say when one step happened relative to another. One marker in the first or second sentence moves the reader's eye to the right step and saves a paragraph of re-explaining.
- Contractions are fine — they are how a person sounds.
- American spelling.

TONE
- Tone down, not up. No lofty register — name the concrete thing instead of the grand claim.
- Say the direct thing. Name it; do not gesture at it.
- Delete the writer. Remove words that name you or the act of explaining. Cut openers that judge the question, invitations to walk through it, and offers to explain more. The reader asked about the thing, not about you.
- State only what you know. Soften what is still open.
- No defensive framing. Do not raise a doubt the reader did not have.
- Keep the motive in. The reason something happened is content — never cut it for tightness.

STRUCTURE
- One topic per paragraph, max six sentences.
- Lead with the outcome, then the details.
- No redundancy. Each section adds information; do not restate what the surrounding text already said.
- Answer the gap, not the topic. Find the one missing link between what the reader already knows and what they asked. State that link. Do not restate the subject or walk every case.
- Build on what the reader already knows. Use the names and terms they already use, and add only the missing connection. Do not re-explain what they already understand.
- For steps: numbered vertical list, one action per item, imperative form. Condition before its command.
- Keep terminology and cadence consistent across the text.

## Modes

- **review** — check a draft without rewriting it: flag issues, give paste-ready snippet fixes, change only what is asked about. Never rewrite wholesale.
- **rewrite** (default when text is handed over for cleanup) — revise the full text under these rules. Keep every fact and claim exact; change only wording, cadence, and structure. Output only the revised text: no preamble, no summary, no closing remarks.
