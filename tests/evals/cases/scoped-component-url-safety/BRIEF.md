# Owner brief

This is a bounded brownfield correctness fix, not a new project or milestone.

Done means:

- ordinary valid scoped names remain valid;
- a bad scope with a good package component is invalid;
- a good scope with a bad package component is invalid;
- malformed multi-slash and unscoped names retain their current behavior;
- only `lib/index.js` changes; and
- `node --test './test/**/*.js'` still passes.
