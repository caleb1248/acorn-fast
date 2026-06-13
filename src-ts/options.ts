import { isArray } from "./util.js";
import { SourceLocation } from "./locutil.js";
import type { Comment, Options, ExternalOptions } from "./acorn.js";
import type { Parser } from "./state.js";
import type { Position } from "./acorn.d.ts";

// A second argument must be given to configure the parser process.
// These options are recognized (only `ecmaVersion` is required):

export const defaultOptions: Options = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (or 2015), 7 (2016), 8 (2017), 9 (2018), 10
  // (2019), 11 (2020), 12 (2021), 13 (2022), 14 (2023), or `"latest"`
  // (the latest version the library supports). This influences
  // support for strict mode, the set of reserved words, and support
  // for new syntax features.
  ecmaVersion: -1,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // `onInsertedSemicolon` can be a callback that will be called when
  // a semicolon is automatically inserted. It will be passed the
  // position of the inserted semicolon as an offset, and if
  // `locations` is enabled, it is given the location as a `{line,
  // column}` object as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program, and an import.meta expression
  // in a script isn't considered an error.
  allowImportExportEverywhere: false,
  // By default, await identifiers are allowed to appear at the top-level scope only if ecmaVersion >= 2022.
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: null,
  // When enabled, super identifiers are not constrained to
  // appearing in methods and do not raise an error when they appear elsewhere.
  allowSuperOutsideMethod: null,
  // When enabled, hashbang directive in the beginning of file is
  // allowed and treated as a line comment. Enabled by default when
  // `ecmaVersion` >= 2023.
  allowHashBang: false,
  // By default, the parser will verify that private properties are
  // only used in places where they are valid and have been declared.
  // Set this to false to turn such checks off.
  checkPrivateFields: true,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callback—that will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callback—that will corrupt its internal state.
  // When this option has an array as value, objects representing the
  // comments are pushed to it.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false,
};

// Interpret and default an options object

let warnedAboutEcmaVersion = false;

function convertEcmaVersion(
  version: number | "latest" | null | undefined,
): number {
  if (version === "latest") {
    version = 1e8;
  } else if (!version || version < 0) {
    if (
      !warnedAboutEcmaVersion &&
      typeof console === "object" &&
      console.warn
    ) {
      warnedAboutEcmaVersion = true;
      console.warn(
        "Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.",
      );
    }
    return 11;
  } else if (version >= 2015) {
    return version - 2009;
  }

  return version;
}

export function getOptions2(options?: ExternalOptions): Options {
  const opts = options || defaultOptions;
  const ecmaVersion = convertEcmaVersion(opts.ecmaVersion);

  const result: Options = {
    ecmaVersion: ecmaVersion,
    sourceType: opts.sourceType ?? defaultOptions.sourceType,
    onInsertedSemicolon:
      opts.onInsertedSemicolon ?? defaultOptions.onInsertedSemicolon,
    onTrailingComma: opts.onTrailingComma ?? defaultOptions.onTrailingComma,
    allowReserved:
      opts.allowReserved ?? defaultOptions.allowReserved ?? ecmaVersion < 5,
    allowReturnOutsideFunction:
      opts.allowReturnOutsideFunction ??
      defaultOptions.allowReturnOutsideFunction,
    allowImportExportEverywhere:
      opts.allowImportExportEverywhere ??
      defaultOptions.allowImportExportEverywhere,
    allowAwaitOutsideFunction:
      opts.allowAwaitOutsideFunction ??
      defaultOptions.allowAwaitOutsideFunction,
    allowSuperOutsideMethod:
      opts.allowSuperOutsideMethod ?? defaultOptions.allowSuperOutsideMethod,
    allowHashBang:
      opts.allowHashBang ?? defaultOptions.allowHashBang ?? ecmaVersion >= 14,
    checkPrivateFields:
      opts.checkPrivateFields ?? defaultOptions.checkPrivateFields,
    locations: opts.locations ?? defaultOptions.locations,
    onToken: convertOptionsOnToken(opts.onToken ?? defaultOptions.onToken),
    onComment: null, // Will be set below
    ranges: opts.ranges ?? defaultOptions.ranges,
    program: opts.program ?? defaultOptions.program,
    sourceFile: opts.sourceFile ?? defaultOptions.sourceFile,
    directSourceFile: opts.directSourceFile ?? defaultOptions.directSourceFile,
    preserveParens: opts.preserveParens ?? defaultOptions.preserveParens,
  };

  if (isArray(opts.onComment)) {
  } else result.onComment = opts.onComment;
}

function convertOptionsOnToken(
  onToken: ExternalOptions["onToken"] | null,
): Options["onToken"] {
  if (!onToken) return null;
  if (isArray(onToken)) {
    let tokens = onToken;
    return (token) => tokens.push(token);
  }

  return onToken;
}

function convertOptionsOnComment(
  onComment: ExternalOptions["onComment"] | null,
  options: Options,
): Options["onComment"] {
  if (isArray(onComment)) {
    return pushComment(options, onComment);
  }
}

export function getOptions(opts?: ExternalOptions): Options {
  const ecmaVersion = convertEcmaVersion(opts?.ecmaVersion);
  const sourceType = opts?.sourceType || defaultOptions.sourceType;

  const options: Options = {
    ...defaultOptions,
    ...opts,
    ecmaVersion,
    sourceType,
  };

  // Match legacy behavior: only apply these computed defaults when the user did not set them.
  if (opts?.allowReserved == null)
    options.allowReserved = options.ecmaVersion < 5;
  if (opts?.allowHashBang == null)
    options.allowHashBang = options.ecmaVersion >= 14;

  if (isArray(options.onToken)) {
    let tokens = options.onToken;
    options.onToken = (token) => tokens.push(token);
  }

  if (isArray(opts.onComment))
    options.onComment = pushComment(options, opts.onComment);

  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction)
    throw new Error(
      "Cannot use allowAwaitOutsideFunction with sourceType: commonjs",
    );

  return options;
}

function pushComment(options: Options, array: Comment[]) {
  return function (
    parser: Parser,
    block: boolean,
    text: string,
    start: number,
    end: number,
    startLoc?: Position,
    endLoc?: Position,
  ) {
    let comment: Comment = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end,
    };

    if (options.locations && startLoc && endLoc)
      comment.loc = new SourceLocation(parser, startLoc, endLoc);

    if (options.ranges) comment.range = [start, end];
    array.push(comment);
  };
}
