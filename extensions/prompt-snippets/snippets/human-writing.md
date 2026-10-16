---
name: human-writing
description: Rewrite prose (technical docs, READMEs, PR text, error messages, release notes, agent reports, comments — never code) into two layered writing stuctured, that is easy to scan and hold in your head. clean up agent or sub-agent report text, Use when asked to make writing not sound like AI, or make docs clear and consistent.
placement: append
order: 10
---

# human-writing

Rewrite any prose into 2 layered structure, ASD-STE100 Simplified Technical English and clear, mapped out text. The bar: the reader should be able to inferred and comprehend it on first read, builds one clear mental model, and never re-reads a sentence to parse it.

Applies to any prose. Never code, identifiers, or command syntax. Not for marketing copy.

## Rules

SENTENCES
- Complete, plain sentences. No em-dash staccato, no rhetorical fragments, no staccato triads. that cadence forces re-reading and is a known AI tell.
- The em dash is banned. Use periods and commas.
- One idea per sentence. Short sentences — around 25 words. A longer one is fine only as a clean parallel list of concrete specifics, not stacked clauses.
- No semicolons. Write two sentences.
- Active voice with the actor named. "the parser reads the file", not "the file is read by the parser".
- No stacked auxiliaries. Not "it is important to note that this may help to improve". Say what is, or cut the sentence.

WORDS
- Concrete specifics instead of adjectives. Delete words that claim quality (seamless, robust, powerful, cutting-edge, effortless, world-class, revolutionary, next-generation). Replace with the detail that earns the claim, or cut the word. ("impactful and valuable" became the actual specs.)
- One name for one thing. Do not call the same item by two different names.
- Short common word where it does not flatten meaning: start (not commence/initiate), use (not utilize/leverage), help (not facilitate), make sure (not ensure), before (not prior to), after (not subsequent to), about (not regarding/concerning), get (not obtain/acquire), show (not demonstrate).
- Contractions are fine — they are how a person sounds.
- American spelling.

TONE
- Tone down, not up. No lofty register — name the concrete thing instead of the grand claim.
- Say the direct thing. Name it; do not gesture at it.
- State only what you know. Soften what is still open.
- No defensive framing. Do not raise a doubt the reader did not have.
- Keep the motive in. The reason something happened is content — never cut it for tightness.

STRUCTURE
- One topic per paragraph, max six sentences.
- Lead with the outcome, then the details.
- No redundancy. Each section adds information; do not restate what the surrounding text already said.
- For steps: numbered vertical list, one action per item, imperative form. Condition before its command.
- Keep terminology and cadence consistent across the text.

## Modes

- **review** — check a draft without rewriting it: flag issues, give paste-ready snippet fixes, change only what is asked about. Never rewrite wholesale.
- **rewrite** (default when text is handed over for cleanup) — revise the full text under these rules. Keep every fact and claim exact; change only wording, cadence, and structure. Output only the revised text: no preamble, no summary, no closing remarks.

## Self-lint (run before returning text)

1. Any em dash? Remove it.
2. Any fragment or staccato triad? Complete the sentence.
3. Any adjective claiming quality? Replace with the specific detail, or cut it.
4. Any lofty register? Replace with the concrete thing.
5. Any defensive framing, inflated claim, or redundancy? Cut it.
6. Any passive voice with a known actor? Make it active.
7. Same thing named two ways? Pick one name.
8. Any stacked auxiliaries or hedge pile-up? Say it plainly, or cut it.
