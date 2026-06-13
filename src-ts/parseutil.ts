import { TokenType, types as tt } from "./tokentype.js";
import type { Parser } from "./state.js";
import { lineBreak, skipWhiteSpace } from "./whitespace.js";
import { raise, raiseRecoverable } from "./location.js";
import { next } from "./tokenize.js";

// ## Parser utilities

const literal = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
export function strictDirective(parser: Parser, start: number) {
  if (parser.options.ecmaVersion < 5) return false;
  for (;;) {
    // Try to find string literal.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(parser.input)![0].length;
    let match = literal.exec(parser.input.slice(start));
    if (!match) return false;
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length;
      let spaceAfter = skipWhiteSpace.exec(parser.input)!,
        end = spaceAfter.index + spaceAfter[0].length;
      let next = parser.input.charAt(end);

      return (
        next === ";" ||
        next === "}" ||
        (lineBreak.test(spaceAfter[0]) &&
          !(
            /[(`.[+\-/*%<>=,?^&]/.test(next) ||
            (next === "!" && parser.input.charAt(end + 1) === "=")
          ))
      );
    }
    start += match[0].length;

    // Skip semicolon, if any.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(parser.input)![0].length;
    if (parser.input[start] === ";") start++;
  }
}

// Predicate that tests whether the next token is of the given
// type, and if yes, consumes it as a side effect.

export function eat(parser: Parser, type: TokenType) {
  if (parser.type === type) {
    next(parser);
    return true;
  } else {
    return false;
  }
}

// Tests whether parsed token is a contextual keyword.

export function isContextual(parser: Parser, name: string) {
  return (
    parser.type === tt.name && parser.value === name && !parser.containsEsc
  );
}

// Consumes contextual keyword if possible.

export function eatContextual(parser: Parser, name: string) {
  if (!isContextual(parser, name)) return false;
  next(parser);
  return true;
}

// Asserts that following token is given contextual keyword.

export function expectContextual(parser: Parser, name: string) {
  if (!eatContextual(parser, name)) unexpected(parser);
}

// Test whether a semicolon can be inserted at the current position.

export function canInsertSemicolon(parser: Parser) {
  return (
    parser.type === tt.eof ||
    parser.type === tt.braceR ||
    lineBreak.test(parser.input.slice(parser.lastTokEnd, parser.start))
  );
}

export function insertSemicolon(parser: Parser) {
  if (canInsertSemicolon(parser)) {
    if (parser.options.onInsertedSemicolon)
      parser.options.onInsertedSemicolon(
        parser.lastTokEnd,
        parser.lastTokEndLoc,
      );
    return true;
  }
}

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

export function semicolon(parser: Parser) {
  if (!eat(parser, tt.semi) && !insertSemicolon(parser)) unexpected(parser);
}

export function afterTrailingComma(
  parser: Parser,
  tokType: TokenType,
  notNext?: boolean,
) {
  if (parser.type === tokType) {
    if (parser.options.onTrailingComma)
      parser.options.onTrailingComma(
        parser.lastTokStart,
        parser.lastTokStartLoc,
      );
    if (!notNext) next(parser);
    return true;
  }
}

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error.

export function expect(parser: Parser, type: TokenType) {
  eat(parser, type) || unexpected(parser);
}

// Raise an unexpected token error.

export function unexpected(parser: Parser, pos?: number) {
  raise(parser, pos != null ? pos : parser.start, "Unexpected token");
}

export class DestructuringErrors {
  shorthandAssign: number;
  trailingComma: number;
  parenthesizedAssign: number;
  parenthesizedBind: number;
  doubleProto: number;

  constructor() {
    this.shorthandAssign =
      this.trailingComma =
      this.parenthesizedAssign =
      this.parenthesizedBind =
      this.doubleProto =
        -1;
  }
}

export function checkPatternErrors(
  parser: Parser,
  refDestructuringErrors?: DestructuringErrors,
  isAssign: boolean = false,
) {
  if (!refDestructuringErrors) return;
  if (refDestructuringErrors.trailingComma > -1)
    raiseRecoverable(
      parser,
      refDestructuringErrors.trailingComma,
      "Comma is not permitted after the rest element",
    );
  let parens = isAssign
    ? refDestructuringErrors.parenthesizedAssign
    : refDestructuringErrors.parenthesizedBind;
  if (parens > -1)
    raiseRecoverable(
      parser,
      parens,
      isAssign ? "Assigning to rvalue" : "Parenthesized pattern",
    );
}

export function checkExpressionErrors(
  parser: Parser,
  refDestructuringErrors?: DestructuringErrors,
  andThrow: boolean = false,
) {
  if (!refDestructuringErrors) return false;
  let { shorthandAssign, doubleProto } = refDestructuringErrors;
  if (!andThrow) return shorthandAssign >= 0 || doubleProto >= 0;
  if (shorthandAssign >= 0)
    raise(
      parser,
      shorthandAssign,
      "Shorthand property assignments are valid only in destructuring patterns",
    );
  if (doubleProto >= 0)
    raiseRecoverable(parser, doubleProto, "Redefinition of __proto__ property");
}

export function checkYieldAwaitInDefaultParams(parser: Parser) {
  if (
    parser.yieldPos &&
    (!parser.awaitPos || parser.yieldPos < parser.awaitPos)
  )
    raise(
      parser,
      parser.yieldPos,
      "Yield expression cannot be a default value",
    );
  if (parser.awaitPos)
    raise(
      parser,
      parser.awaitPos,
      "Await expression cannot be a default value",
    );
}

export function isSimpleAssignTarget(parser: Parser, expr) {
  if (expr.type === "ParenthesizedExpression")
    return isSimpleAssignTarget(parser, expr.expression);
  return expr.type === "Identifier" || expr.type === "MemberExpression";
}
