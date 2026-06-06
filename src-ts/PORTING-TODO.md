# Acorn TypeScript Port TODO

- Port the public entry point first: `index.js`.
- Port the parser core.
  - `options.js`
  - `util.js`
  - `locutil.js`
  - `whitespace.js`
  - `scopeflags.js`
  - `identifier.js`
  - `tokentype.js`
  - `tokencontext.js`
  - `node.js`
  - `state.js`
  - `parseutil.js`
  - `statement.js`
  - `lval.js`
  - `expression.js`
  - `location.js`
  - `scope.js`
  - `tokenize.js`
  - `regexp.js`

Rules:

- Align the runtime output with types declared in `parser.d.ts`.
- This will be ported to rust in the future. This means:
  - Augmenting the prototype of anything is not allowed
  - All objects must have a explicit interface that describes the shape. `Object.assign()` is not allowed
  - The use of `any` is **NEVER** allowed.
