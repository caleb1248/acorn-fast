import { isIdentifierStart, isIdentifierChar } from "./identifier.js";
import { types as tt, keywords as keywordTypes, TokenType } from "./tokentype.js";
import type { Parser } from "./state.js";
import { SourceLocation } from "./locutil.js";
import { RegExpValidationState } from "./regexp.js";
import { lineBreak, nextLineBreak, isNewLine, nonASCIIwhitespace } from "./whitespace";
import { codePointToString } from "./util";
import { raise, raiseRecoverable, curPosition } from "./location";
import { curContext as _curContext, updateContext } from "./tokencontext";

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

export class Token {
  public type: TokenType;
  public value: string | null; // may need to change
  public start: number;
  public end: number;
  public loc?: SourceLocation;
  public range?: [number, number] | null;

  constructor(p: Parser) {
    this.type = p.type;
    this.value = p.value;
    this.start = p.start;
    this.end = p.end;
    if (p.options.locations && p.startLoc && p.endLoc)
      this.loc = new SourceLocation(p, p.startLoc, p.endLoc);
    if (p.options.ranges) this.range = [p.start, p.end];
  }
}

/**
 * Move to the next token
 */
export function next(parser: Parser, ignoreEscapeSequenceInKeyword = false) {
  if (!ignoreEscapeSequenceInKeyword && parser.type.keyword && parser.containsEsc)
    raiseRecoverable(parser, parser.start, "Escape sequence in keyword " + parser.type.keyword);
  if (parser.options.onToken) parser.options.onToken(new Token(parser));

  parser.lastTokEnd = parser.end;
  parser.lastTokStart = parser.start;
  parser.lastTokEndLoc = parser.endLoc;
  parser.lastTokStartLoc = parser.startLoc;
  nextToken(parser);
}

export function getToken(parser: Parser) {
  next(parser);
  return new Token(parser);
}

// If we're in an ES6 environment, make parsers iterable
if (typeof Symbol !== "undefined") {
  // pp[Symbol.iterator] = function () {
  //   return {
  //     next: () => {
  //       let token = this.getToken();
  //       return {
  //         done: token.type === tt.eof,
  //         value: token,
  //       };
  //     },
  //   };
  // };
}

// Toggle strict mode. Re-reads the next number or string to please
// pedantic tests (`"use strict"; 010;` should fail).

// Read a single token, updating the parser object's token-related
// properties.

export function nextToken(parser: Parser) {
  let curContext = _curContext(parser);
  if (!curContext || !curContext.preserveSpace) skipSpace(parser);

  parser.start = parser.pos;
  if (parser.options.locations) parser.startLoc = curPosition(parser);
  if (parser.pos >= parser.input.length) return finishToken(parser, tt.eof, null);

  if (curContext.override) return curContext.override(parser);
  else readToken(parser, fullCharCodeAtPos(parser));
}

export function readToken(parser: Parser, code: number) {
  // Identifier or keyword. '\uXXXX' sequences are allowed in
  // identifiers, so '\' also dispatches to that.
  if (isIdentifierStart(code, parser.options.ecmaVersion >= 6) || code === 92 /* '\' */)
    return readWord(parser);

  return getTokenFromCode(parser, code);
}

export function fullCharCodeAt(parser: Parser, pos: number) {
  let code = parser.input.charCodeAt(pos);
  if (code <= 0xd7ff || code >= 0xdc00) return code;
  let next = parser.input.charCodeAt(pos + 1);
  return next <= 0xdbff || next >= 0xe000 ? code : (code << 10) + next - 0x35fdc00;
}

export function fullCharCodeAtPos(parser: Parser) {
  return fullCharCodeAt(parser, parser.pos);
}

export function skipBlockComment(parser: Parser) {
  let startLoc = parser.options.onComment && curPosition(parser);
  let start = parser.pos,
    end = parser.input.indexOf("*/", (parser.pos += 2));
  if (end === -1) raise(parser, parser.pos - 2, "Unterminated comment");
  parser.pos = end + 2;
  if (parser.options.locations) {
    for (
      let nextBreak, pos = start;
      (nextBreak = nextLineBreak(parser.input, pos, parser.pos)) > -1;
    ) {
      ++parser.curLine;
      pos = parser.lineStart = nextBreak;
    }
  }
  if (parser.options.onComment)
    parser.options.onComment(
      parser,
      true,
      parser.input.slice(start + 2, end),
      start,
      parser.pos,
      startLoc,
      curPosition(parser),
    );
}

export function skipLineComment(parser: Parser, startSkip: number) {
  let start = parser.pos;
  let startLoc = parser.options.onComment && curPosition(parser);
  let ch = parser.input.charCodeAt((parser.pos += startSkip));
  while (parser.pos < parser.input.length && !isNewLine(ch)) {
    ch = parser.input.charCodeAt(++parser.pos);
  }
  if (parser.options.onComment)
    parser.options.onComment(
      parser,
      false,
      parser.input.slice(start + startSkip, parser.pos),
      start,
      parser.pos,
      startLoc,
      curPosition(parser),
    );
}

// Called at the start of the parse and after every token. Skips
// whitespace and comments, and.

export function skipSpace(parser: Parser) {
  loop: while (parser.pos < parser.input.length) {
    let ch = parser.input.charCodeAt(parser.pos);
    switch (ch) {
      case 32:
      case 160: // ' '
        ++parser.pos;
        break;
      case 13:
        if (parser.input.charCodeAt(parser.pos + 1) === 10) {
          ++parser.pos;
        }
      case 10:
      case 8232:
      case 8233:
        ++parser.pos;
        if (parser.options.locations) {
          ++parser.curLine;
          parser.lineStart = parser.pos;
        }
        break;
      case 47: // '/'
        switch (parser.input.charCodeAt(parser.pos + 1)) {
          case 42: // '*'
            skipBlockComment(parser);
            break;
          case 47:
            skipLineComment(parser, 2);
            break;
          default:
            break loop;
        }
        break;
      default:
        if (
          (ch > 8 && ch < 14) ||
          (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch)))
        ) {
          ++parser.pos;
        } else {
          break loop;
        }
    }
  }
}

// Called at the end of every token. Sets `end`, `val`, and
// maintains `context` and `exprAllowed`, and skips the space after
// the token, so that the next one's `start` will point at the
// right position.

export function finishToken(parser: Parser, type: TokenType, val: string | null) {
  parser.end = parser.pos;
  if (parser.options.locations) parser.endLoc = curPosition(parser);
  let prevType = parser.type;
  parser.type = type;
  parser.value = val;

  updateContext(parser, prevType);
}

// ### Token reading

// This is the function that is called to fetch the next token. It
// is somewhat obscure, because it works in character codes rather
// than characters, and because operator parsing has been inlined
// into it.
//
// All in the name of speed.
//
export function readToken_dot(parser: Parser) {
  let next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) return this.readNumber(true);
  let next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) {
    // 46 = dot '.'
    this.pos += 3;
    return this.finishToken(tt.ellipsis);
  } else {
    ++this.pos;
    return this.finishToken(tt.dot);
  }
}

export function readToken_slash(parser: Parser) {
  // '/'
  let next = parser.input.charCodeAt(parser.pos + 1);
  if (parser.exprAllowed) {
    ++parser.pos;
    return readRegexp(parser);
  }
  if (next === 61) return finishOp(parser, tt.assign, 2);
  return finishOp(parser, tt.slash, 1);
}

export function readToken_mult_modulo_exp(parser: Parser, code) {
  // '%*'
  let next = this.input.charCodeAt(this.pos + 1);
  let size = 1;
  let tokentype = code === 42 ? tt.star : tt.modulo;

  // exponentiation operator ** and **=
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = tt.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }

  if (next === 61) return this.finishOp(tt.assign, size + 1);
  return this.finishOp(tokentype, size);
}

export function readToken_pipe_amp(parser: Parser, code) {
  // '|&'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      let next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) return this.finishOp(tt.assign, 3);
    }
    return this.finishOp(code === 124 ? tt.logicalOR : tt.logicalAND, 2);
  }
  if (next === 61) return this.finishOp(tt.assign, 2);
  return this.finishOp(code === 124 ? tt.bitwiseOR : tt.bitwiseAND, 1);
}

export function readToken_caret(parser: Parser) {
  // '^'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) return this.finishOp(tt.assign, 2);
  return this.finishOp(tt.bitwiseXOR, 1);
}

export function readToken_plus_min(parser: Parser, code: number) {
  // '+-'
  let next = parser.input.charCodeAt(parser.pos + 1);
  if (next === code) {
    if (
      next === 45 &&
      !parser.inModule &&
      parser.input.charCodeAt(parser.pos + 2) === 62 &&
      (parser.lastTokEnd === 0 || lineBreak.test(parser.input.slice(parser.lastTokEnd, parser.pos)))
    ) {
      // A `-->` line comment
      skipLineComment(parser, 3);
      skipSpace(parser);
      return nextToken(parser);
    }
    return finishOp(parser, tt.incDec, 2);
  }
  if (next === 61) return finishOp(parser, tt.assign, 2);
  return finishOp(parser, tt.plusMin, 1);
}

export function readToken_lt_gt(parser: Parser, code: number) {
  // '<>'
  let next = parser.input.charCodeAt(parser.pos + 1);
  let size = 1;
  if (next === code) {
    size = code === 62 && parser.input.charCodeAt(parser.pos + 2) === 62 ? 3 : 2;
    if (parser.input.charCodeAt(parser.pos + size) === 61)
      return finishOp(parser, tt.assign, size + 1);
    return finishOp(parser, tt.bitShift, size);
  }
  if (
    next === 33 &&
    code === 60 &&
    !parser.inModule &&
    parser.input.charCodeAt(parser.pos + 2) === 45 &&
    parser.input.charCodeAt(parser.pos + 3) === 45
  ) {
    // `<!--`, an XML-style comment that should be interpreted as a line comment
    skipLineComment(parser, 4);
    skipSpace(parser);
    return nextToken(parser);
  }
  if (next === 61) size = 2;
  return finishOp(parser, tt.relational, size);
}

export function readToken_eq_excl(parser: Parser, code) {
  // '=!'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === 61)
    return this.finishOp(tt.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) {
    // '=>'
    this.pos += 2;
    return this.finishToken(tt.arrow);
  }
  return this.finishOp(code === 61 ? tt.eq : tt.prefix, 1);
}

export function readToken_question(parser: Parser) {
  // '?'
  const ecmaVersion = this.options.ecmaVersion;
  if (ecmaVersion >= 11) {
    let next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      let next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) return this.finishOp(tt.questionDot, 2);
    }
    if (next === 63) {
      if (ecmaVersion >= 12) {
        let next2 = this.input.charCodeAt(this.pos + 2);
        if (next2 === 61) return this.finishOp(tt.assign, 3);
      }
      return this.finishOp(tt.coalesce, 2);
    }
  }
  return this.finishOp(tt.question, 1);
}

export function readToken_numberSign(parser: Parser) {
  // '#'
  const ecmaVersion = this.options.ecmaVersion;
  let code = 35; // '#'
  if (ecmaVersion >= 13) {
    ++this.pos;
    code = this.fullCharCodeAtPos();
    if (isIdentifierStart(code, true) || code === 92 /* '\' */) {
      return this.finishToken(tt.privateId, this.readWord1());
    }
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
}

export function getTokenFromCode(parser: Parser, code: number) {
  switch (code) {
    // The interpretation of a dot depends on whether it is followed
    // by a digit or another two dots.
    case 46: // '.'
      return this.readToken_dot();

    // Punctuation tokens.
    case 40:
      ++this.pos;
      return finishToken(parser, tt.parenL);
    case 41:
      ++this.pos;
      return finishToken(parser, tt.parenR);
    case 59:
      ++this.pos;
      return finishToken(parser, tt.semi);
    case 44:
      ++this.pos;
      return finishToken(parser, tt.comma);
    case 91:
      ++this.pos;
      return finishToken(parser, tt.bracketL);
    case 93:
      ++this.pos;
      return finishToken(parser, tt.bracketR);
    case 123:
      ++this.pos;
      return finishToken(parser, tt.braceL);
    case 125:
      ++this.pos;
      return finishToken(parser, tt.braceR);
    case 58:
      ++this.pos;
      return finishToken(parser, tt.colon);

    case 96: // '`'
      if (this.options.ecmaVersion < 6) break;
      ++this.pos;
      return finishToken(parser, tt.backQuote);

    case 48: // '0'
      let next = this.input.charCodeAt(this.pos + 1);
      if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
      if (this.options.ecmaVersion >= 6) {
        if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number
        if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
      }

    // Anything else beginning with a digit is an integer, octal
    // number, or float.
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57: // 1-9
      return this.readNumber(false);

    // Quotes produce strings.
    case 34:
    case 39: // '"', "'"
      return this.readString(code);

    // Operators are parsed inline in tiny state machines. '=' (61) is
    // often referred to. `finishOp` simply skips the amount of
    // characters it is given as second argument, and returns a token
    // of the type given by its first argument.
    case 47: // '/'
      return this.readToken_slash();

    case 37:
    case 42: // '%*'
      return this.readToken_mult_modulo_exp(code);

    case 124:
    case 38: // '|&'
      return this.readToken_pipe_amp(code);

    case 94: // '^'
      return this.readToken_caret();

    case 43:
    case 45: // '+-'
      return this.readToken_plus_min(code);

    case 60:
    case 62: // '<>'
      return this.readToken_lt_gt(code);

    case 61:
    case 33: // '=!'
      return this.readToken_eq_excl(code);

    case 63: // '?'
      return this.readToken_question();

    case 126: // '~'
      return this.finishOp(tt.prefix, 1);

    case 35: // '#'
      return this.readToken_numberSign();
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
}

export function finishOp(parser: Parser, type: TokenType, size: number) {
  let str = parser.input.slice(parser.pos, parser.pos + size);
  parser.pos += size;
  return finishToken(parser, type, str);
}

export function readRegexp(parser: Parser) {
  let escaped,
    inClass,
    start = parser.pos;
  for (;;) {
    if (parser.pos >= parser.input.length) raise(parser, start, "Unterminated regular expression");
    let ch = parser.input.charAt(parser.pos);
    if (lineBreak.test(ch)) raise(parser, start, "Unterminated regular expression");
    if (!escaped) {
      if (ch === "[") inClass = true;
      else if (ch === "]" && inClass) inClass = false;
      else if (ch === "/" && !inClass) break;
      escaped = ch === "\\";
    } else escaped = false;
    ++parser.pos;
  }
  let pattern = parser.input.slice(start, parser.pos);
  ++parser.pos;
  let flagsStart = parser.pos;
  let flags = readWord1(parser);
  if (parser.containsEsc) unexpected(flagsStart);

  // Validate pattern
  const state = parser.regexpState || (parser.regexpState = new RegExpValidationState(parser));
  state.reset(start, pattern, flags);
  validateRegExpFlags(parser, state);
  validateRegExpPattern(parser, state);

  // Create Literal#value property value.
  let value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch {
    // ESTree requires null if it failed to instantiate RegExp object.
    // https://github.com/estree/estree/blob/a27003adf4fd7bfad44de9cef372a2eacd527b1c/es5.md#regexpliteral
  }

  return finishToken(parser, tt.regexp, { pattern, flags, value });
}

// Read an integer in the given radix. Return null if zero digits
// were read, the integer value otherwise. When `len` is given, this
// will return `null` unless the integer has exactly `len` digits.

export function readInt(
  parser: Parser,
  radix: number,
  len?: number,
  maybeLegacyOctalNumericLiteral?: boolean,
) {
  // `len` is used for character escape sequences. In that case, disallow separators.
  const allowSeparators = parser.options.ecmaVersion >= 12 && len === undefined;

  // `maybeLegacyOctalNumericLiteral` is true if it doesn't have prefix (0x,0o,0b)
  // and isn't fraction part nor exponent part. In that case, if the first digit
  // is zero then disallow separators.
  const isLegacyOctalNumericLiteral =
    maybeLegacyOctalNumericLiteral && parser.input.charCodeAt(parser.pos) === 48;

  let start = parser.pos,
    total = 0,
    lastCode = 0;
  for (let i = 0, e = len == null ? Infinity : len; i < e; ++i, ++parser.pos) {
    let code = parser.input.charCodeAt(parser.pos),
      val;

    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral)
        raiseRecoverable(
          parser,
          parser.pos,
          "Numeric separator is not allowed in legacy octal numeric literals",
        );
      if (lastCode === 95)
        raiseRecoverable(parser, parser.pos, "Numeric separator must be exactly one underscore");
      if (i === 0)
        raiseRecoverable(
          parser,
          parser.pos,
          "Numeric separator is not allowed at the first of digits",
        );
      lastCode = code;
      continue;
    }

    if (code >= 97)
      val = code - 97 + 10; // a
    else if (code >= 65)
      val = code - 65 + 10; // A
    else if (code >= 48 && code <= 57)
      val = code - 48; // 0-9
    else val = Infinity;
    if (val >= radix) break;
    lastCode = code;
    total = total * radix + val;
  }

  if (allowSeparators && lastCode === 95)
    raiseRecoverable(
      parser,
      parser.pos - 1,
      "Numeric separator is not allowed at the last of digits",
    );
  if (parser.pos === start || (len != null && parser.pos - start !== len)) return null;

  return total;
}

function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8);
  }

  // `parseFloat(value)` stops parsing at the first numeric separator then returns a wrong value.
  return parseFloat(str.replace(/_/g, ""));
}

function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null;
  }

  // `BigInt(value)` throws syntax error if the string contains numeric separators.
  return BigInt(str.replace(/_/g, ""));
}

export function readRadixNumber(parser: Parser, radix) {
  let start = parser.pos;
  parser.pos += 2; // 0x
  let val = readInt(parser, radix);
  if (val == null) this.raise(this.start + 2, "Expected number in radix " + radix);
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if (isIdentifierStart(this.fullCharCodeAtPos()))
    this.raise(this.pos, "Identifier directly after number");
  return finishToken(parser, tt.num, val);
}

// Read an integer, octal integer, or floating-point number.

export function readNumber(parser: Parser, startsWithDot) {
  let start = this.pos;
  if (!startsWithDot && this.readInt(10, undefined, true) === null)
    this.raise(start, "Invalid number");
  let octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) this.raise(start, "Invalid number");
  let next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    let val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if (isIdentifierStart(this.fullCharCodeAtPos()))
      this.raise(this.pos, "Identifier directly after number");
    return this.finishToken(tt.num, val);
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) octal = false;
  if (next === 46 && !octal) {
    // '.'
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) {
    // 'eE'
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) ++this.pos; // '+-'
    if (this.readInt(10) === null) this.raise(start, "Invalid number");
  }
  if (isIdentifierStart(this.fullCharCodeAtPos()))
    this.raise(this.pos, "Identifier directly after number");

  let val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(tt.num, val);
}

// Read a string value, interpreting backslash-escapes.

export function readCodePoint(parser: Parser) {
  let ch = parser.input.charCodeAt(parser.pos),
    code;

  if (ch === 123) {
    // '{'
    if (parser.options.ecmaVersion < 6) unexpected(parser);
    let codePos = ++parser.pos;
    code = readHexChar(parser, parser.input.indexOf("}", parser.pos) - parser.pos);
    ++parser.pos;
    if (code > 0x10ffff) invalidStringToken(parser, codePos, "Code point out of bounds");
  } else {
    code = readHexChar(parser, 4);
  }
  return code;
}

export function readString(parser: Parser, quote) {
  let out = "",
    chunkStart = ++this.pos;
  for (;;) {
    if (this.pos >= this.input.length) this.raise(this.start, "Unterminated string constant");
    let ch = this.input.charCodeAt(this.pos);
    if (ch === quote) break;
    if (ch === 92) {
      // '\'
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else if (ch === 0x2028 || ch === 0x2029) {
      if (this.options.ecmaVersion < 10) this.raise(this.start, "Unterminated string constant");
      ++this.pos;
      if (this.options.locations) {
        this.curLine++;
        this.lineStart = this.pos;
      }
    } else {
      if (isNewLine(ch)) this.raise(this.start, "Unterminated string constant");
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(tt.string, out);
}

// Reads template string tokens.

const INVALID_TEMPLATE_ESCAPE_ERROR = {};

export function tryReadTemplateToken(parser: Parser) {
  parser.inTemplateElement = true;
  try {
    parser.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      parser.readInvalidTemplateToken();
    } else {
      throw err;
    }
  }

  parser.inTemplateElement = false;
}

export function invalidStringToken(parser: Parser, position: number, message: string) {
  if (parser.inTemplateElement && parser.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR;
  } else {
    raise(parser, position, message);
  }
}

export function readTmplToken(parser: Parser) {
  let out = "",
    chunkStart = parser.pos;
  for (;;) {
    if (parser.pos >= parser.input.length) raise(parser, parser.start, "Unterminated template");
    let ch = parser.input.charCodeAt(parser.pos);
    if (ch === 96 || (ch === 36 && parser.input.charCodeAt(parser.pos + 1) === 123)) {
      // '`', '${'
      if (
        parser.pos === parser.start &&
        (parser.type === tt.template || parser.type === tt.invalidTemplate)
      ) {
        if (ch === 36) {
          parser.pos += 2;
          return finishToken(parser, tt.dollarBraceL);
        } else {
          ++parser.pos;
          return finishToken(parser, tt.backQuote);
        }
      }
      out += parser.input.slice(chunkStart, parser.pos);
      return finishToken(parser, tt.template, out);
    }
    if (ch === 92) {
      // '\'
      out += parser.input.slice(chunkStart, parser.pos);
      out += readEscapedChar(parser, true);
      chunkStart = parser.pos;
    } else if (isNewLine(ch)) {
      out += parser.input.slice(chunkStart, parser.pos);
      ++parser.pos;
      switch (ch) {
        case 13:
          if (parser.input.charCodeAt(parser.pos) === 10) ++parser.pos;
        case 10:
          out += "\n";
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (parser.options.locations) {
        ++parser.curLine;
        parser.lineStart = parser.pos;
      }
      chunkStart = parser.pos;
    } else {
      ++parser.pos;
    }
  }
}

// Reads a template token to search for the end, without validating any escape sequences
export function readInvalidTemplateToken(parser: Parser) {
  for (; parser.pos < parser.input.length; parser.pos++) {
    switch (parser.input[parser.pos]) {
      case "\\":
        ++parser.pos;
        break;

      case "$":
        if (parser.input[parser.pos + 1] !== "{") break;
      // fall through
      case "`":
        return finishToken(
          parser,
          tt.invalidTemplate,
          parser.input.slice(parser.start, parser.pos),
        );

      case "\r":
        if (parser.input[parser.pos + 1] === "\n") ++parser.pos;
      // fall through
      case "\n":
      case "\u2028":
      case "\u2029":
        ++parser.curLine;
        parser.lineStart = parser.pos + 1;
        break;
    }
  }
  raise(parser, parser.start, "Unterminated template");
}

// Used to read escaped characters

export function readEscapedChar(parser: Parser, inTemplate: boolean) {
  let ch = parser.input.charCodeAt(++parser.pos);
  ++parser.pos;
  switch (ch) {
    case 110:
      return "\n"; // 'n' -> '\n'
    case 114:
      return "\r"; // 'r' -> '\r'
    case 120:
      return String.fromCharCode(readHexChar(parser, 2)); // 'x'
    case 117:
      return codePointToString(readCodePoint(parser)); // 'u'
    case 116:
      return "\t"; // 't' -> '\t'
    case 98:
      return "\b"; // 'b' -> '\b'
    case 118:
      return "\u000b"; // 'v' -> '\u000b'
    case 102:
      return "\f"; // 'f' -> '\f'
    case 13:
      if (parser.input.charCodeAt(parser.pos) === 10) ++parser.pos; // '\r\n'
    case 10: // ' \n'
      if (parser.options.locations) {
        parser.lineStart = parser.pos;
        ++parser.curLine;
      }
      return "";
    case 56:
    case 57:
      if (parser.strict) {
        invalidStringToken(parser, parser.pos - 1, "Invalid escape sequence");
      }
      if (inTemplate) {
        const codePos = parser.pos - 1;

        invalidStringToken(parser, codePos, "Invalid escape sequence in template string");
      }
    default:
      if (ch >= 48 && ch <= 55) {
        let octalStr = parser.input.substr(parser.pos - 1, 3).match(/^[0-7]+/)[0];
        let octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        parser.pos += octalStr.length - 1;
        ch = parser.input.charCodeAt(parser.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (parser.strict || inTemplate)) {
          invalidStringToken(
            parser,
            parser.pos - 1 - octalStr.length,
            inTemplate ? "Octal literal in template string" : "Octal literal in strict mode",
          );
        }
        return String.fromCharCode(octal);
      }
      if (isNewLine(ch)) {
        // Unicode new line characters after \ get removed from output in both
        // template literals and strings
        if (parser.options.locations) {
          parser.lineStart = parser.pos;
          ++parser.curLine;
        }
        return "";
      }
      return String.fromCharCode(ch);
  }
}

// Used to read character escape sequences ('\x', '\u', '\U').

export function readHexChar(parser: Parser, len: number) {
  let codePos = parser.pos;
  let n = readInt(parser, 16, len);
  if (n === null) invalidStringToken(parser, codePos, "Bad character escape sequence");
  return n;
}

// Read an identifier, and return it as a string. Sets `this.containsEsc`
// to whether the word contained a '\u' escape.
//
// Incrementally adds only escaped chars, adding other chunks as-is
// as a micro-optimization.

export function readWord1(parser: Parser) {
  parser.containsEsc = false;
  let word = "",
    first = true,
    chunkStart = parser.pos;
  let astral = parser.options.ecmaVersion >= 6;
  while (parser.pos < parser.input.length) {
    let ch = fullCharCodeAtPos(parser);
    if (isIdentifierChar(ch, astral)) {
      parser.pos += ch <= 0xffff ? 1 : 2;
    } else if (ch === 92) {
      // "\"
      parser.containsEsc = true;
      word += parser.input.slice(chunkStart, parser.pos);
      let escStart = parser.pos;
      if (parser.input.charCodeAt(++parser.pos) !== 117)
        // "u"
        invalidStringToken(parser, parser.pos, "Expecting Unicode escape sequence \\uXXXX");
      ++parser.pos;
      let esc = readCodePoint(parser);
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral))
        invalidStringToken(parser, escStart, "Invalid Unicode escape");
      word += codePointToString(esc);
      chunkStart = parser.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + parser.input.slice(chunkStart, parser.pos);
}

// Read an identifier or keyword token. Will check for reserved
// words when necessary.

export function readWord(parser: Parser) {
  let word = readWord1(parser);
  let type = tt.name;
  if (parser.keywords.test(word)) {
    type = keywordTypes.get(word)!;
  }

  return finishToken(parser, type, word);
}
