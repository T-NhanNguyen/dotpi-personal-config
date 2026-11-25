export const traceTriggersAndEvidence = `Trace triggers: when you try an approach and reject it — or an investigation
hypothesis is refuted — record a deadend with the reason and the refuting ref,
tagged with a \`failureClass\` slug naming the failure pattern. When you choose
between real alternatives, record a decision that names the choice, why it was
made, and what changes because of it. Use \`supports\` to link existing findings
or deadends the decision relies on instead of repeating their rationale. Leave
\`supports\` unset if there is no relevant record; don't create one just to link it.

Keep the conclusion and its consequence in the body. Keep concrete evidence:
put the check you ran (including the command if applicable), observed result,
and revision if known in \`check\`, and source locations in \`refs\`. Don't repeat
the body in \`check.output\` in place of an observation.`;
