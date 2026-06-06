import { reservedWords, keywords } from "./identifier.js";
import { types as tt, type TokenType } from "./tokentype.js";
import { lineBreak } from "./whitespace.js";
import { getOptions } from "./options.js";
import { wordsRegexp } from "./util.js";
import { strictDirective } from "./parseutil.js";
import { curPosition } from "./location.js";
import { initialContext } from "./tokencontext.js";
import {
  enterScope,
  currentScope,
  currentVarScope,
  currentThisScope,
  treatFunctionsAsVarInScope,
} from "./scope.js";
import {
  SCOPE_TOP,
  SCOPE_FUNCTION,
  SCOPE_ASYNC,
  SCOPE_GENERATOR,
  SCOPE_SUPER,
  SCOPE_DIRECT_SUPER,
  SCOPE_ARROW,
  SCOPE_CLASS_STATIC_BLOCK,
  SCOPE_CLASS_FIELD_INIT,
  SCOPE_SWITCH,
} from "./scopeflags.js";
import type { Scope } from "./scope.js";
import type { Options, Parser as ExposedParser, Position, Identifier, Literal } from "./acorn.d.ts";
import { RegExpValidationState } from "./regexp.js";

import { nextToken } from "./tokenize";

/**
 * @internal
 */
export interface Label {
  kind: string;
  name?: string;
  statementStart?: number;
}

export interface PrivateNameStackElement {
  declared: Node[];
  used: Node[];
}

export class Parser implements ExposedParser {
  public options: Options;
  public sourceFile: string;
  private keywords: RegExp;
  public input: string;
  public reservedWords: RegExp;
  public reservedWordsStrict: RegExp;
  public reservedWordsStrictBind: RegExp;
  public containsEsc: boolean;
  public pos: number;
  public lineStart: number;
  public curLine: number;
  public type: TokenType;
  public value: null;
  public start: number;
  public end: number;
  public startLoc: Position;
  public endLoc: Position;
  public lastTokEndLoc: Position;
  public lastTokStartLoc: null;
  public lastTokStart: number;
  public lastTokEnd: number;
  public context: import("./tokencontext.js").TokContext[];
  public exprAllowed: boolean;
  public inModule: boolean;
  public strict: boolean;
  public potentialArrowAt: number;
  public potentialArrowInForAwait: boolean;
  public yieldPos: number;
  public awaitPos: number;
  public awaitIdentPos: number;
  public scopeStack: Scope[];
  public labels: Label[];
  public regexpState: RegExpValidationState;
  public undefinedExports: (Identifier | Literal)[];

  constructor(options: Options, input: string, startPos?: number) {
    this.options = options = getOptions(options);
    this.sourceFile = options.sourceFile;
    this.keywords = wordsRegexp(
      keywords[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5],
    );
    let reserved = "";
    if (options.allowReserved !== true) {
      reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
      if (options.sourceType === "module") reserved += " await";
    }
    this.reservedWords = wordsRegexp(reserved);
    let reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
    this.reservedWordsStrict = wordsRegexp(reservedStrict);
    this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
    this.input = String(input);

    // Used to signal to callers of `readWord1` whether the word
    // contained any escape sequences. This is needed because words with
    // escape sequences must not be interpreted as keywords.
    this.containsEsc = false;

    // Set up token state

    // The current position of the tokenizer in the input.
    if (startPos) {
      this.pos = startPos;
      this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
      this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
    } else {
      this.pos = this.lineStart = 0;
      this.curLine = 1;
    }

    // Properties of the current token:
    // Its type
    this.type = tt.eof;
    // For tokens that include more information than their type, the value
    this.value = null;
    // Its start and end offset
    this.start = this.end = this.pos;
    // And, if locations are used, the {line, column} object
    // corresponding to those offsets
    this.startLoc = this.endLoc = curPosition(this);

    // Position information for the previous token
    this.lastTokEndLoc = this.lastTokStartLoc = null;
    this.lastTokStart = this.lastTokEnd = this.pos;

    // The context stack is used to superficially track syntactic
    // context to predict whether a regular expression is allowed in a
    // given position.
    this.context = initialContext();
    this.exprAllowed = true;

    // Figure out if it's a module code.
    this.inModule = options.sourceType === "module";
    this.strict = this.inModule || strictDirective(this, this.pos);

    // Used to signify the start of a potential arrow function
    this.potentialArrowAt = -1;
    this.potentialArrowInForAwait = false;

    // Positions to delayed-check that yield/await does not exist in default parameters.
    this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
    // Labels in scope.
    this.labels = [];
    // Thus-far undefined exports.
    this.undefinedExports = Object.create(null);

    // If enabled, skip leading hashbang line.
    if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!")
      this.skipLineComment(2);

    // Scope tracking for duplicate variable names (see scope.js)
    this.scopeStack = [];
    enterScope(
      this,
      this.options.sourceType === "commonjs"
        ? // In commonjs, the top-level scope behaves like a function scope
          SCOPE_FUNCTION
        : SCOPE_TOP,
    );

    // For RegExp validation
    this.regexpState = null;

    // The stack of private names.
    // Each element has two properties: 'declared' and 'used'.
    // When it exited from the outermost class definition, all used private names must be declared.
    this.privateNameStack = [];
  }

  parse() {
    let node = this.options.program || this.startNode();
    nextToken(this);
    return this.parseTopLevel(node);
  }

  get inFunction() {
    return (currentVarScope(this).flags & SCOPE_FUNCTION) > 0;
  }

  get inGenerator() {
    return (currentVarScope(this).flags & SCOPE_GENERATOR) > 0;
  }

  get inAsync() {
    return (currentVarScope(this).flags & SCOPE_ASYNC) > 0;
  }

  get canAwait() {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      let { flags } = this.scopeStack[i];
      if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) return false;
      if (flags & SCOPE_FUNCTION) return (flags & SCOPE_ASYNC) > 0;
    }
    return (
      (this.inModule && this.options.ecmaVersion >= 13) || this.options.allowAwaitOutsideFunction
    );
  }

  get allowReturn() {
    if (this.inFunction) return true;
    if (this.options.allowReturnOutsideFunction && currentVarScope(this).flags & SCOPE_TOP)
      return true;
    return false;
  }

  get allowSuper() {
    const { flags } = currentThisScope(this);
    return (flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod;
  }

  get allowDirectSuper() {
    return (currentThisScope(this).flags & SCOPE_DIRECT_SUPER) > 0;
  }

  get treatFunctionsAsVar() {
    return treatFunctionsAsVarInScope(this, currentScope(this));
  }

  get allowNewDotTarget() {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      let { flags } = this.scopeStack[i];
      if (
        flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) ||
        (flags & SCOPE_FUNCTION && !(flags & SCOPE_ARROW))
      )
        return true;
    }
    return false;
  }

  get allowUsing() {
    const { flags } = currentScope(this);
    if (flags & SCOPE_SWITCH) return false;
    if (!this.inModule && flags & SCOPE_TOP) return false;
    return true;
  }

  get inClassStaticBlock() {
    return (currentVarScope(this).flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
  }

  static parse(input: string, options: Options) {
    return new this(options, input).parse();
  }

  static parseExpressionAt(input: string, pos: number, options: Options) {
    let parser = new this(options, input, pos);
    parser.nextToken();
    return parser.parseExpression();
  }

  static tokenizer(input: string, options: Options) {
    return new this(options, input);
  }
}
