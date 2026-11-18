# Trace Review Language

A trace captures findings, decisions, evidence, and human feedback. These terms distinguish feedback from the other records in a trace.

## Language

**Review**:
Human-authored feedback recorded within a trace. Only reviews are eligible for review deletion.
_Avoid_: Comment

**Staged review deletion**:
A review selected for permanent deletion but not yet removed. Staging expresses intent; confirmation authorizes removal.

**Review deletion**:
Permanent removal of a review from its trace, not merely hiding it from the viewer. A user must confirm staged review deletions before they take effect.

**Review promotion**:
Preservation of a surviving child review by connecting it to all nearest surviving targets through deleted review ancestors, retaining its other connections. A child with no surviving targets becomes a trace-level review.

**Protected review**:
A review directly supported by any non-review record, so its feedback has become part of the trace structure and cannot be deleted.

**Trace-level review**:
A review of the trace as a whole, without a connection to an individual record.
