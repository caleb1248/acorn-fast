// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

import { types as tt } from "./tokentype";
import { types as tokenCtxTypes } from "./tokencontext";
import { Parser } from "./state";
import {
  canInsertSemicolon,
  checkExpressionErrors,
  DestructuringErrors,
  eat,
  expect,
  unexpected,
} from "./parseutil";
import { lineBreak } from "./whitespace";
import {
  functionFlags,
  SCOPE_ARROW,
  SCOPE_SUPER,
  SCOPE_DIRECT_SUPER,
  BIND_OUTSIDE,
  BIND_VAR,
  SCOPE_VAR,
} from "./scopeflags";
import { raise, raiseRecoverable } from "./location";
import { finishNode, startNode, startNodeAt } from "./node.js";
import { checkLValPattern, checkLValSimple, toAssignable } from "./lval";
import { next } from "./tokenize";
import { AnyNode, MemberExpression } from "./acorn";

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash —
// either with each other or with an init property — and in
// strict mode, init properties are also not allowed to be repeated.

export function checkPropClash(parser: Parser, prop, propHash, refDestructuringErrors) {
  if (parser.options.ecmaVersion >= 9 && prop.type === "SpreadElement") return;
  if (parser.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand)) return;
  let { key } = prop,
    name;
  switch (key.type) {
    case "Identifier":
      name = key.name;
      break;
    case "Literal":
      name = String(key.value);
      break;
    default:
      return;
  }
  let { kind } = prop;
  if (parser.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key.start;
          }
        } else {
          raiseRecoverable(parser, key.start, "Redefinition of __proto__ property");
        }
      }
      propHash.proto = true;
    }
    return;
  }
  name = "$" + name;
  let other = propHash[name];
  if (other) {
    let redefinition;
    if (kind === "init") {
      redefinition = (parser.strict && other.init) || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition) raiseRecoverable(parser, key.start, "Redefinition of property");
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false,
    };
  }
  other[kind] = true;
}

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function(s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

export function parseExpression(parser: Parser, forInit, refDestructuringErrors) {
  let startPos = parser.start,
    startLoc = parser.startLoc;
  let expr = parseMaybeAssign(parser, forInit, refDestructuringErrors);
  if (parser.type === tt.comma) {
    let node = startNodeAt(parser, startPos, startLoc);
    node.expressions = [expr];
    while (eat(parser, tt.comma))
      node.expressions.push(parseMaybeAssign(parser, forInit, refDestructuringErrors));
    return finishNode(parser, node, "SequenceExpression");
  }
  return expr;
}

// Parse an assignment expression. parser includes applications of
// operators like `+=`.

export function parseMaybeAssign(
  parser: Parser,
  forInit,
  refDestructuringErrors?: DestructuringErrors,
  afterLeftParse?: any,
) {
  if (isContextual(parser, "yield")) {
    if (parser.inGenerator) return parseYield(parser, forInit);
    // The tokenizer will assume an expression is allowed after
    // `yield`, but parser isn't that kind of yield
    else parser.exprAllowed = false;
  }

  let ownDestructuringErrors = false,
    oldParenAssign = -1,
    oldTrailingComma = -1,
    oldDoubleProto = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldDoubleProto = refDestructuringErrors.doubleProto;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors();
    ownDestructuringErrors = true;
  }

  let startPos = parser.start,
    startLoc = parser.startLoc;
  if (parser.type === tt.parenL || parser.type === tt.name) {
    parser.potentialArrowAt = parser.start;
    parser.potentialArrowInForAwait = forInit === "await";
  }

  let left = parseMaybeConditional(parser, forInit, refDestructuringErrors);

  if (afterLeftParse) left = afterLeftParse.call(parser, left, startPos, startLoc);
  if (parser.type.isAssign) {
    let node = startNodeAt(parser, startPos, startLoc);
    node.operator = parser.value;
    if (parser.type === tt.eq) left = toAssignable(parser, left, false, refDestructuringErrors);
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign =
        refDestructuringErrors.trailingComma =
        refDestructuringErrors.doubleProto =
          -1;
    }
    if (refDestructuringErrors.shorthandAssign >= left.start)
      refDestructuringErrors.shorthandAssign = -1; // reset because shorthand default was used correctly
    if (parser.type === tt.eq) checkLValPattern(parser, left);
    else checkLValSimple(parser, left);
    node.left = left;
    next(parser);
    node.right = parseMaybeAssign(parser, forInit);
    if (oldDoubleProto > -1) refDestructuringErrors.doubleProto = oldDoubleProto;
    return finishNode(parser, node, "AssignmentExpression");
  } else {
    if (ownDestructuringErrors) checkExpressionErrors(parser, refDestructuringErrors, true);
  }
  if (oldParenAssign > -1) refDestructuringErrors.parenthesizedAssign = oldParenAssign;
  if (oldTrailingComma > -1) refDestructuringErrors.trailingComma = oldTrailingComma;
  return left;
}

// Parse a ternary conditional (`?:`) operator.

export function parseMaybeConditional(
  parser: Parser,
  forInit,
  refDestructuringErrors: DestructuringErrors,
) {
  let startPos = parser.start,
    startLoc = parser.startLoc;
  let expr = parseExprOps(parser, forInit, refDestructuringErrors);
  if (checkExpressionErrors(parser, refDestructuringErrors)) return expr;
  if (
    !(expr.type === "ArrowFunctionExpression" && expr.start === startPos) &&
    eat(parser, tt.question)
  ) {
    let node = startNodeAt(parser, startPos, startLoc);
    node.test = expr;
    node.consequent = parseMaybeAssign(parser);
    expect(parser, tt.colon);
    node.alternate = parseMaybeAssign(parser, forInit);
    return finishNode(parser, node, "ConditionalExpression");
  }
  return expr;
}

// Start the precedence parser.

export function parseExprOps(parser: Parser, forInit, refDestructuringErrors: DestructuringErrors) {
  let startPos = parser.start,
    startLoc = parser.startLoc;
  let expr = parseMaybeUnary(parser, refDestructuringErrors, false, false, forInit);
  if (checkExpressionErrors(parser, refDestructuringErrors)) return expr;
  return expr.start === startPos && expr.type === "ArrowFunctionExpression"
    ? expr
    : parseExprOp(parser, expr, startPos, startLoc, -1, forInit);
}

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

export function parseExprOp(parser: Parser, left, leftStartPos, leftStartLoc, minPrec, forInit) {
  let prec = parser.type.binop;
  if (prec != null && (!forInit || parser.type !== tt._in)) {
    if (prec > minPrec) {
      let logical = parser.type === tt.logicalOR || parser.type === tt.logicalAND;
      let coalesce = parser.type === tt.coalesce;
      if (coalesce) {
        // Handle the precedence of `tt.coalesce` as equal to the range of logical expressions.
        // In other words, `node.right` shouldn't contain logical expressions in order to check the mixed error.
        prec = tt.logicalAND.binop;
      }
      let op = parser.value;
      next(parser);
      let startPos = parser.start,
        startLoc = parser.startLoc;
      let right = parseExprOp(
        parser,
        parseMaybeUnary(parser, null, false, false, forInit),
        startPos,
        startLoc,
        prec,
        forInit,
      );
      let node = buildBinary(
        parser,
        leftStartPos,
        leftStartLoc,
        left,
        right,
        op,
        logical || coalesce,
      );
      if (
        (logical && parser.type === tt.coalesce) ||
        (coalesce && (parser.type === tt.logicalOR || parser.type === tt.logicalAND))
      ) {
        raiseRecoverable(
          parser,
          parser.start,
          "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses",
        );
      }
      return parseExprOp(parser, node, leftStartPos, leftStartLoc, minPrec, forInit);
    }
  }
  return left;
}

export function buildBinary(parser: Parser, startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier")
    raise(parser, right.start, "Private identifier can only be left side of binary expression");
  let node = startNodeAt(parser, startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return finishNode(parser, node, logical ? "LogicalExpression" : "BinaryExpression");
}

// Parse unary operators, both prefix and postfix.

export function parseMaybeUnary(parser: Parser, refDestructuringErrors, sawUnary, incDec, forInit) {
  let startPos = parser.start,
    startLoc = parser.startLoc,
    expr;
  if (isContextual(parser, "await") && parser.canAwait) {
    expr = parseAwait(parser, forInit);
    sawUnary = true;
  } else if (parser.type.prefix) {
    let node = startNode(parser),
      update = parser.type === tt.incDec;
    node.operator = parser.value;
    node.prefix = true;
    next(parser);
    node.argument = parseMaybeUnary(parser, null, true, update, forInit);
    checkExpressionErrors(parser, refDestructuringErrors, true);
    if (update) checkLValSimple(parser, node.argument);
    else if (parser.strict && node.operator === "delete" && isLocalVariableAccess(node.argument))
      raiseRecoverable(parser, node.start, "Deleting local variable in strict mode");
    else if (node.operator === "delete" && isPrivateFieldAccess(node.argument))
      raiseRecoverable(parser, node.start, "Private fields can not be deleted");
    else sawUnary = true;
    expr = finishNode(parser, node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (!sawUnary && parser.type === tt.privateId) {
    if ((forInit || parser.privateNameStack.length === 0) && parser.options.checkPrivateFields)
      unexpected(parser);
    expr = parsePrivateIdent(parser);
    // only could be private fields in 'in', such as #x in obj
    if (parser.type !== tt._in) unexpected(parser);
  } else {
    expr = parseExprSubscripts(parser, refDestructuringErrors, forInit);
    if (checkExpressionErrors(parser, refDestructuringErrors)) return expr;
    while (parser.type.postfix && !canInsertSemicolon(parser)) {
      let node = startNodeAt(parser, startPos, startLoc);
      node.operator = parser.value;
      node.prefix = false;
      node.argument = expr;
      checkLValSimple(parser, expr);
      next(parser);
      expr = finishNode(parser, node, "UpdateExpression");
    }
  }

  if (!incDec && eat(parser, tt.starstar)) {
    if (sawUnary) unexpected(parser, parser.lastTokStart);
    else
      return buildBinary(
        parser,
        startPos,
        startLoc,
        expr,
        parseMaybeUnary(parser, null, false, false, forInit),
        "**",
        false,
      );
  } else {
    return expr;
  }
}

function isLocalVariableAccess(node) {
  return (
    node.type === "Identifier" ||
    (node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression))
  );
}

function isPrivateFieldAccess(node) {
  return (
    (node.type === "MemberExpression" && node.property.type === "PrivateIdentifier") ||
    (node.type === "ChainExpression" && isPrivateFieldAccess(node.expression)) ||
    (node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression))
  );
}

// Parse call, dot, and `[]`-subscript expressions.

export function parseExprSubscripts(parser: Parser, refDestructuringErrors, forInit) {
  let startPos = parser.start,
    startLoc = parser.startLoc;
  let expr = parseExprAtom(parser, refDestructuringErrors, forInit);
  if (
    expr.type === "ArrowFunctionExpression" &&
    parser.input.slice(parser.lastTokStart, parser.lastTokEnd) !== ")"
  )
    return expr;
  let result = parseSubscripts(parser, expr, startPos, startLoc, false, forInit);
  if (refDestructuringErrors && result.type === "MemberExpression") {
    if (refDestructuringErrors.parenthesizedAssign >= result.start)
      refDestructuringErrors.parenthesizedAssign = -1;
    if (refDestructuringErrors.parenthesizedBind >= result.start)
      refDestructuringErrors.parenthesizedBind = -1;
    if (refDestructuringErrors.trailingComma >= result.start)
      refDestructuringErrors.trailingComma = -1;
  }
  return result;
}

export function parseSubscripts(
  parser: Parser,
  base: AnyNode,
  startPos: number,
  startLoc,
  noCalls,
  forInit,
) {
  let maybeAsyncArrow =
    parser.options.ecmaVersion >= 8 &&
    base.type === "Identifier" &&
    base.name === "async" &&
    parser.lastTokEnd === base.end &&
    !canInsertSemicolon(parser) &&
    base.end - base.start === 5 &&
    parser.potentialArrowAt === base.start;
  let optionalChained = false;

  while (true) {
    let element = parseSubscript(
      parser,
      base,
      startPos,
      startLoc,
      noCalls,
      maybeAsyncArrow,
      optionalChained,
      forInit,
    );

    if (element.optional) optionalChained = true;
    if (element === base || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        const chainNode = startNodeAt(parser, startPos, startLoc);
        chainNode.expression = element;
        element = finishNode(parser, chainNode, "ChainExpression");
      }
      return element;
    }

    base = element;
  }
}

export function shouldParseAsyncArrow(parser: Parser) {
  return !canInsertSemicolon(parser) && eat(parser, tt.arrow);
}

export function parseSubscriptAsyncArrow(parser: Parser, startPos, startLoc, exprList, forInit) {
  return parseArrowExpression(
    parser,
    startNodeAt(parser, startPos, startLoc),
    exprList,
    true,
    forInit,
  );
}

export function parseSubscript(
  parser: Parser,
  base,
  startPos,
  startLoc,
  noCalls,
  maybeAsyncArrow,
  optionalChained,
  forInit,
) {
  let optionalSupported = parser.options.ecmaVersion >= 11;
  let optional = optionalSupported && eat(parser, tt.questionDot);
  if (noCalls && optional)
    raise(
      parser,
      parser.lastTokStart,
      "Optional chaining cannot appear in the callee of new expressions",
    );

  let computed = eat(parser, tt.bracketL);
  if (
    computed ||
    (optional && parser.type !== tt.parenL && parser.type !== tt.backQuote) ||
    eat(parser, tt.dot)
  ) {
    let node = startNodeAt(parser, startPos, startLoc) as MemberExpression;
    node.object = base;
    if (computed) {
      node.property = parseExpression(parser);
      expect(parser, tt.bracketR);
    } else if (parser.type === tt.privateId && base.type !== "Super") {
      node.property = parsePrivateIdent(parser);
    } else {
      node.property = parseIdent(parser, parser.options.allowReserved !== "never");
    }
    node.computed = !!computed;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = finishNode(parser, node, "MemberExpression");
  } else if (!noCalls && eat(parser, tt.parenL)) {
    let refDestructuringErrors = new DestructuringErrors(),
      oldYieldPos = parser.yieldPos,
      oldAwaitPos = parser.awaitPos,
      oldAwaitIdentPos = parser.awaitIdentPos;
    parser.yieldPos = 0;
    parser.awaitPos = 0;
    parser.awaitIdentPos = 0;

    let exprList = parseExprList(
      parser,
      tt.parenR,
      parser.options.ecmaVersion >= 8,
      false,
      refDestructuringErrors,
    );

    if (maybeAsyncArrow && !optional && shouldParseAsyncArrow(parser)) {
      checkPatternErrors(parser, refDestructuringErrors, false);
      checkYieldAwaitInDefaultParams(parser);
      if (parser.awaitIdentPos > 0)
        raise(
          parser,
          parser.awaitIdentPos,
          "Cannot use 'await' as identifier inside an async function",
        );
      parser.yieldPos = oldYieldPos;
      parser.awaitPos = oldAwaitPos;
      parser.awaitIdentPos = oldAwaitIdentPos;
      return parseSubscriptAsyncArrow(parser, startPos, startLoc, exprList, forInit);
    }
    checkExpressionErrors(parser, refDestructuringErrors, true);
    parser.yieldPos = oldYieldPos || parser.yieldPos;
    parser.awaitPos = oldAwaitPos || parser.awaitPos;
    parser.awaitIdentPos = oldAwaitIdentPos || parser.awaitIdentPos;
    let node = startNodeAt(parser, startPos, startLoc);
    node.callee = base;
    node.arguments = exprList;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = finishNode(parser, node, "CallExpression");
  } else if (parser.type === tt.backQuote) {
    if (optional || optionalChained) {
      raise(
        parser,
        parser.start,
        "Optional chaining cannot appear in the tag of tagged template expressions",
      );
    }
    let node = startNodeAt(parser, startPos, startLoc);
    node.tag = base;
    node.quasi = parseTemplate(parser, { isTagged: true });
    base = finishNode(parser, node, "TaggedTemplateExpression");
  }
  return base;
}

// Parse an atomic expression — either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.

export function parseExprAtom(parser: Parser, refDestructuringErrors, forInit, forNew) {
  // If a division operator appears in an expression position, the
  // tokenizer got confused, and we force it to read a regexp instead.
  if (parser.type === tt.slash) readRegexp(parser);

  let node,
    canBeArrow = parser.potentialArrowAt === parser.start;
  switch (parser.type) {
    case tt._super:
      if (!parser.allowSuper) raise(parser, parser.start, "'super' keyword outside a method");
      node = startNode(parser);
      next(parser);
      if (parser.type === tt.parenL && !parser.allowDirectSuper)
        raise(parser, node.start, "super() call outside constructor of a subclass");
      // The `super` keyword can appear at below:
      // SuperProperty:
      //     super [ Expression ]
      //     super . IdentifierName
      // SuperCall:
      //     super ( Arguments )
      if (parser.type !== tt.dot && parser.type !== tt.bracketL && parser.type !== tt.parenL)
        unexpected(parser);
      return finishNode(parser, node, "Super");

    case tt._parser:
      node = startNode(parser);
      next(parser);
      return finishNode(parser, node, "parserExpression");

    case tt.name:
      let startPos = parser.start,
        startLoc = parser.startLoc,
        containsEsc = parser.containsEsc;
      let id = parseIdent(parser, false);
      if (
        parser.options.ecmaVersion >= 8 &&
        !containsEsc &&
        id.name === "async" &&
        !canInsertSemicolon(parser) &&
        eat(parser, tt._function)
      ) {
        overrideContext(parser, tokenCtxTypes.f_expr);
        return parseFunction(
          parser,
          startNodeAt(parser, startPos, startLoc),
          0,
          false,
          true,
          forInit,
        );
      }
      if (canBeArrow && !canInsertSemicolon(parser)) {
        if (eat(parser, tt.arrow))
          return parseArrowExpression(
            parser,
            startNodeAt(parser, startPos, startLoc),
            [id],
            false,
            forInit,
          );
        if (
          parser.options.ecmaVersion >= 8 &&
          id.name === "async" &&
          parser.type === tt.name &&
          !containsEsc &&
          (!parser.potentialArrowInForAwait || parser.value !== "of" || parser.containsEsc)
        ) {
          id = parseIdent(parser, false);
          if (canInsertSemicolon(parser) || !eat(parser, tt.arrow)) unexpected(parser);
          return parseArrowExpression(
            parser,
            startNodeAt(parser, startPos, startLoc),
            [id],
            true,
            forInit,
          );
        }
      }
      return id;

    case tt.regexp:
      let value = parser.value;
      node = parseLiteral(parser, value.value);
      node.regex = { pattern: value.pattern, flags: value.flags };
      return node;

    case tt.num:
    case tt.string:
      return parseLiteral(parser, parser.value);

    case tt._null:
    case tt._true:
    case tt._false:
      node = startNode(parser);
      node.value = parser.type === tt._null ? null : parser.type === tt._true;
      node.raw = parser.type.keyword;
      next(parser);
      return finishNode(parser, node, "Literal");

    case tt.parenL:
      let start = parser.start,
        expr = parseParenAndDistinguishExpression(parser, canBeArrow, forInit);
      if (refDestructuringErrors) {
        if (refDestructuringErrors.parenthesizedAssign < 0 && !isSimpleAssignTarget(parser, expr))
          refDestructuringErrors.parenthesizedAssign = start;
        if (refDestructuringErrors.parenthesizedBind < 0)
          refDestructuringErrors.parenthesizedBind = start;
      }
      return expr;

    case tt.bracketL:
      node = startNode(parser);
      next(parser);
      node.elements = parseExprList(parser, tt.bracketR, true, true, refDestructuringErrors);
      return finishNode(parser, node, "ArrayExpression");

    case tt.braceL:
      overrideContext(parser, tokenCtxTypes.b_expr);
      return parseObj(parser, false, refDestructuringErrors);

    case tt._function:
      node = startNode(parser);
      next(parser);
      return parseFunction(parser, node, 0);

    case tt._class:
      return parseClass(parser, startNode(parser), false);

    case tt._new:
      return parseNew(parser);

    case tt.backQuote:
      return parseTemplate(parser);

    case tt._import:
      if (parser.options.ecmaVersion >= 11) {
        return parseExprImport(parser, forNew);
      } else {
        return unexpected(parser);
      }

    default:
      return parseExprAtomDefault(parser);
  }
}

export function parseExprAtomDefault(parser: Parser) {
  unexpected(parser);
}

export function parseExprImport(parser: Parser, forNew) {
  const node = startNode(parser);

  // Consume `import` as an identifier for `import.meta`.
  // Because `parseIdent(parser,true)` doesn't check escape sequences, it needs the check of `parser.containsEsc`.
  if (parser.containsEsc)
    raiseRecoverable(parser, parser.start, "Escape sequence in keyword import");
  next(parser);

  if (parser.type === tt.parenL && !forNew) {
    return parseDynamicImport(parser, node);
  } else if (parser.type === tt.dot) {
    let meta = startNodeAt(parser, node.start, node.loc && node.loc.start);
    meta.name = "import";
    node.meta = finishNode(parser, meta, "Identifier");
    return parseImportMeta(parser, node);
  } else {
    unexpected(parser);
  }
}

export function parseDynamicImport(parser: Parser, node) {
  next(parser); // skip `(`

  // Parse node.source.
  node.source = parseMaybeAssign(parser);

  if (parser.options.ecmaVersion >= 16) {
    if (!eat(parser, tt.parenR)) {
      expect(parser, tt.comma);
      if (!afterTrailingComma(parser, tt.parenR)) {
        node.options = parseMaybeAssign(parser);
        if (!eat(parser, tt.parenR)) {
          expect(parser, tt.comma);
          if (!afterTrailingComma(parser, tt.parenR)) {
            unexpected(parser);
          }
        }
      } else {
        node.options = null;
      }
    } else {
      node.options = null;
    }
  } else {
    // Verify ending.
    if (!eat(parser, tt.parenR)) {
      const errorPos = parser.start;
      if (eat(parser, tt.comma) && eat(parser, tt.parenR)) {
        raiseRecoverable(parser, errorPos, "Trailing comma is not allowed in import()");
      } else {
        unexpected(parser, errorPos);
      }
    }
  }

  return finishNode(parser, node, "ImportExpression");
}

export function parseImportMeta(parser: Parser, node) {
  next(parser); // skip `.`

  const containsEsc = parser.containsEsc;
  node.property = parseIdent(parser, true);

  if (node.property.name !== "meta")
    raiseRecoverable(
      parser,
      node.property.start,
      "The only valid meta property for import is 'import.meta'",
    );
  if (containsEsc)
    raiseRecoverable(parser, node.start, "'import.meta' must not contain escaped characters");
  if (parser.options.sourceType !== "module" && !parser.options.allowImportExportEverywhere)
    raiseRecoverable(parser, node.start, "Cannot use 'import.meta' outside a module");

  return finishNode(parser, node, "MetaProperty");
}

export function parseLiteral(parser: Parser, value) {
  let node = startNode(parser);
  node.value = value;
  node.raw = parser.input.slice(parser.start, parser.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110)
    node.bigint =
      node.value != null ? node.value.toString() : node.raw.slice(0, -1).replace(/_/g, "");
  next(parser);
  return finishNode(parser, node, "Literal");
}

export function parseParenExpression(parser: Parser) {
  expect(parser, tt.parenL);
  let val = parseExpression(parser);
  expect(parser, tt.parenR);
  return val;
}

export function shouldParseArrow(parser: Parser, exprList) {
  return !canInsertSemicolon(parser);
}

export function parseParenAndDistinguishExpression(parser: Parser, canBeArrow, forInit) {
  let startPos = parser.start,
    startLoc = parser.startLoc,
    val,
    allowTrailingComma = parser.options.ecmaVersion >= 8;
  if (parser.options.ecmaVersion >= 6) {
    next(parser);

    let innerStartPos = parser.start,
      innerStartLoc = parser.startLoc;
    let exprList = [],
      first = true,
      lastIsComma = false;
    let refDestructuringErrors = new DestructuringErrors(),
      oldYieldPos = parser.yieldPos,
      oldAwaitPos = parser.awaitPos,
      spreadStart;
    parser.yieldPos = 0;
    parser.awaitPos = 0;
    // Do not save awaitIdentPos to allow checking awaits nested in parameters
    while (parser.type !== tt.parenR) {
      first ? (first = false) : expect(parser, tt.comma);
      if (allowTrailingComma && afterTrailingComma(parser, tt.parenR, true)) {
        lastIsComma = true;
        break;
      } else if (parser.type === tt.ellipsis) {
        spreadStart = parser.start;
        exprList.push(parseParenItem(parser, parseRestBinding(parser)));
        if (parser.type === tt.comma) {
          raiseRecoverable(parser, parser.start, "Comma is not permitted after the rest element");
        }
        break;
      } else {
        exprList.push(
          parseMaybeAssign(parser, false, refDestructuringErrors, parser.parseParenItem),
        );
      }
    }
    let innerEndPos = parser.lastTokEnd,
      innerEndLoc = parser.lastTokEndLoc;
    expect(parser, tt.parenR);

    if (canBeArrow && shouldParseArrow(parser, exprList) && eat(parser, tt.arrow)) {
      checkPatternErrors(parser, refDestructuringErrors, false);
      checkYieldAwaitInDefaultParams(parser);
      parser.yieldPos = oldYieldPos;
      parser.awaitPos = oldAwaitPos;
      return parseParenArrowList(parser, startPos, startLoc, exprList, forInit);
    }

    if (!exprList.length || lastIsComma) unexpected(parser, parser.lastTokStart);
    if (spreadStart) unexpected(parser, spreadStart);
    checkExpressionErrors(parser, refDestructuringErrors, true);
    parser.yieldPos = oldYieldPos || parser.yieldPos;
    parser.awaitPos = oldAwaitPos || parser.awaitPos;

    if (exprList.length > 1) {
      val = startNodeAt(parser, innerStartPos, innerStartLoc);
      val.expressions = exprList;
      finishNodeAt(parser, val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = parseParenExpression(parser);
  }

  if (parser.options.preserveParens) {
    let par = startNodeAt(parser, startPos, startLoc);
    par.expression = val;
    return finishNode(parser, par, "ParenthesizedExpression");
  } else {
    return val;
  }
}

export function parseParenItem(parser: Parser, item) {
  return item;
}

export function parseParenArrowList(parser: Parser, startPos, startLoc, exprList, forInit) {
  return parseArrowExpression(
    parser,
    startNodeAt(parser, startPos, startLoc),
    exprList,
    false,
    forInit,
  );
}

// New's precedence is slightly tricky. It must allow its argument to
// be a `[]` or dot subscript expression, but not a call — at least,
// not without wrapping it in parentheses. Thus, it uses the noCalls
// argument to parseSubscripts to prevent it from consuming the
// argument list.

const empty = [];

export function parseNew(parser: Parser) {
  if (parser.containsEsc) raiseRecoverable(parser, parser.start, "Escape sequence in keyword new");
  let node = startNode(parser);
  next(parser);
  if (parser.options.ecmaVersion >= 6 && parser.type === tt.dot) {
    let meta = startNodeAt(parser, node.start, node.loc && node.loc.start);
    meta.name = "new";
    node.meta = finishNode(parser, meta, "Identifier");
    next(parser);
    let containsEsc = parser.containsEsc;
    node.property = parseIdent(parser, true);
    if (node.property.name !== "target")
      raiseRecoverable(
        parser,
        node.property.start,
        "The only valid meta property for new is 'new.target'",
      );
    if (containsEsc)
      raiseRecoverable(parser, node.start, "'new.target' must not contain escaped characters");
    if (!parser.allowNewDotTarget)
      raiseRecoverable(
        parser,
        node.start,
        "'new.target' can only be used in functions and class static block",
      );
    return finishNode(parser, node, "MetaProperty");
  }
  let startPos = parser.start,
    startLoc = parser.startLoc;
  node.callee = parseSubscripts(
    parser,
    parseExprAtom(parser, null, false, true),
    startPos,
    startLoc,
    true,
    false,
  );
  if (node.callee.type === "Super") raiseRecoverable(parser, startPos, "Invalid use of 'super'");
  if (eat(parser, tt.parenL))
    node.arguments = parseExprList(parser, tt.parenR, parser.options.ecmaVersion >= 8, false);
  else node.arguments = empty;
  return finishNode(parser, node, "NewExpression");
}

// Parse template expression.

export function parseTemplateElement(parser: Parser, { isTagged }) {
  let elem = startNode(parser);
  if (parser.type === tt.invalidTemplate) {
    if (!isTagged) {
      raiseRecoverable(parser, parser.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: parser.value.replace(/\r\n?/g, "\n"),
      cooked: null,
    };
  } else {
    elem.value = {
      raw: parser.input.slice(parser.start, parser.end).replace(/\r\n?/g, "\n"),
      cooked: parser.value,
    };
  }
  next(parser);
  elem.tail = parser.type === tt.backQuote;
  return finishNode(parser, elem, "TemplateElement");
}

export function parseTemplate(parser: Parser, { isTagged = false } = {}) {
  let node = startNode(parser);
  next(parser);
  node.expressions = [];
  let curElt = parseTemplateElement(parser, { isTagged });
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (parser.type === tt.eof) raise(parser, parser.pos, "Unterminated template literal");
    expect(parser, tt.dollarBraceL);
    node.expressions.push(parseExpression(parser));
    expect(parser, tt.braceR);
    node.quasis.push((curElt = parseTemplateElement(parser, { isTagged })));
  }
  next(parser);
  return finishNode(parser, node, "TemplateLiteral");
}

export function isAsyncProp(parser: Parser, prop) {
  return (
    !prop.computed &&
    prop.key.type === "Identifier" &&
    prop.key.name === "async" &&
    (parser.type === tt.name ||
      parser.type === tt.num ||
      parser.type === tt.string ||
      parser.type === tt.bracketL ||
      parser.type.keyword ||
      (parser.options.ecmaVersion >= 9 && parser.type === tt.star)) &&
    !lineBreak.test(parser.input.slice(parser.lastTokEnd, parser.start))
  );
}

// Parse an object literal or binding pattern.

export function parseObj(parser: Parser, isPattern, refDestructuringErrors) {
  let node = startNode(parser),
    first = true,
    propHash = {};
  node.properties = [];
  next(parser);
  while (!eat(parser, tt.braceR)) {
    if (!first) {
      expect(parser, tt.comma);
      if (parser.options.ecmaVersion >= 5 && afterTrailingComma(parser, tt.braceR)) break;
    } else first = false;

    const prop = parseProperty(parser, isPattern, refDestructuringErrors);
    if (!isPattern) checkPropClash(parser, prop, propHash, refDestructuringErrors);
    node.properties.push(prop);
  }
  return finishNode(parser, node, isPattern ? "ObjectPattern" : "ObjectExpression");
}

export function parseProperty(parser: Parser, isPattern, refDestructuringErrors) {
  let prop = startNode(parser),
    isGenerator,
    isAsync,
    startPos,
    startLoc;
  if (parser.options.ecmaVersion >= 9 && eat(parser, tt.ellipsis)) {
    if (isPattern) {
      prop.argument = parseIdent(parser, false);
      if (parser.type === tt.comma) {
        raiseRecoverable(parser, parser.start, "Comma is not permitted after the rest element");
      }
      return finishNode(parser, prop, "RestElement");
    }
    // Parse argument.
    prop.argument = parseMaybeAssign(parser, false, refDestructuringErrors);
    // To disallow trailing comma via `toAssignable(parser,)`.
    if (
      parser.type === tt.comma &&
      refDestructuringErrors &&
      refDestructuringErrors.trailingComma < 0
    ) {
      refDestructuringErrors.trailingComma = parser.start;
    }
    // Finish
    return finishNode(parser, prop, "SpreadElement");
  }
  if (parser.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = parser.start;
      startLoc = parser.startLoc;
    }
    if (!isPattern) isGenerator = eat(parser, tt.star);
  }
  let containsEsc = parser.containsEsc;
  parsePropertyName(parser, prop);
  if (
    !isPattern &&
    !containsEsc &&
    parser.options.ecmaVersion >= 8 &&
    !isGenerator &&
    isAsyncProp(parser, prop)
  ) {
    isAsync = true;
    isGenerator = parser.options.ecmaVersion >= 9 && eat(parser, tt.star);
    parsePropertyName(parser, prop);
  } else {
    isAsync = false;
  }
  parsePropertyValue(
    parser,
    prop,
    isPattern,
    isGenerator,
    isAsync,
    startPos,
    startLoc,
    refDestructuringErrors,
    containsEsc,
  );
  return finishNode(parser, prop, "Property");
}

export function parseGetterSetter(parser: Parser, prop) {
  const kind = prop.key.name;
  parsePropertyName(parser, prop);
  prop.value = parseMethod(parser, false);
  prop.kind = kind;
  let paramCount = prop.kind === "get" ? 0 : 1;
  if (prop.value.params.length !== paramCount) {
    let start = prop.value.start;
    if (prop.kind === "get") raiseRecoverable(parser, start, "getter should have no params");
    else raiseRecoverable(parser, start, "setter should have exactly one param");
  } else {
    if (prop.kind === "set" && prop.value.params[0].type === "RestElement")
      raiseRecoverable(parser, prop.value.params[0].start, "Setter cannot use rest params");
  }
}

export function parsePropertyValue(
  parser: Parser,
  prop,
  isPattern,
  isGenerator,
  isAsync,
  startPos,
  startLoc,
  refDestructuringErrors,
  containsEsc,
) {
  if ((isGenerator || isAsync) && parser.type === tt.colon) unexpected(parser);

  if (eat(parser, tt.colon)) {
    prop.value = isPattern
      ? parseMaybeDefault(parser, parser.start, parser.startLoc)
      : parseMaybeAssign(parser, false, refDestructuringErrors);
    prop.kind = "init";
  } else if (parser.options.ecmaVersion >= 6 && parser.type === tt.parenL) {
    if (isPattern) unexpected(parser);
    prop.method = true;
    prop.value = parseMethod(parser, isGenerator, isAsync);
    prop.kind = "init";
  } else if (
    !isPattern &&
    !containsEsc &&
    parser.options.ecmaVersion >= 5 &&
    !prop.computed &&
    prop.key.type === "Identifier" &&
    (prop.key.name === "get" || prop.key.name === "set") &&
    parser.type !== tt.comma &&
    parser.type !== tt.braceR &&
    parser.type !== tt.eq
  ) {
    if (isGenerator || isAsync) unexpected(parser);
    parseGetterSetter(parser, prop);
  } else if (parser.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) unexpected(parser);
    checkUnreserved(parser, prop.key);
    if (prop.key.name === "await" && !parser.awaitIdentPos) parser.awaitIdentPos = startPos;
    if (isPattern) {
      prop.value = parseMaybeDefault(parser, startPos, startLoc, copyNode(parser, prop.key));
    } else if (parser.type === tt.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0)
        refDestructuringErrors.shorthandAssign = parser.start;
      prop.value = parseMaybeDefault(parser, startPos, startLoc, copyNode(parser, prop.key));
    } else {
      prop.value = copyNode(parser, prop.key);
    }
    prop.kind = "init";
    prop.shorthand = true;
  } else unexpected(parser);
}

export function parsePropertyName(parser: Parser, prop) {
  if (parser.options.ecmaVersion >= 6) {
    if (eat(parser, tt.bracketL)) {
      prop.computed = true;
      prop.key = parseMaybeAssign(parser);
      expect(parser, tt.bracketR);
      return prop.key;
    } else {
      prop.computed = false;
    }
  }
  return (prop.key =
    parser.type === tt.num || parser.type === tt.string
      ? parseExprAtom(parser)
      : parseIdent(parser, parser.options.allowReserved !== "never"));
}

// Initialize empty function node.

export function initFunction(parser: Parser, node) {
  node.id = null;
  if (parser.options.ecmaVersion >= 6) node.generator = node.expression = false;
  if (parser.options.ecmaVersion >= 8) node.async = false;
}

// Parse object or class method.

export function parseMethod(parser: Parser, isGenerator, isAsync, allowDirectSuper) {
  let node = startNode(parser),
    oldYieldPos = parser.yieldPos,
    oldAwaitPos = parser.awaitPos,
    oldAwaitIdentPos = parser.awaitIdentPos;

  initFunction(parser, node);
  if (parser.options.ecmaVersion >= 6) node.generator = isGenerator;
  if (parser.options.ecmaVersion >= 8) node.async = !!isAsync;

  parser.yieldPos = 0;
  parser.awaitPos = 0;
  parser.awaitIdentPos = 0;
  enterScope(
    parser,
    functionFlags(isAsync, node.generator) |
      SCOPE_SUPER |
      (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0),
  );

  expect(parser, tt.parenL);
  node.params = parseBindingList(parser, tt.parenR, false, parser.options.ecmaVersion >= 8);
  checkYieldAwaitInDefaultParams(parser);
  parseFunctionBody(parser, node, false, true, false);

  parser.yieldPos = oldYieldPos;
  parser.awaitPos = oldAwaitPos;
  parser.awaitIdentPos = oldAwaitIdentPos;
  return finishNode(parser, node, "FunctionExpression");
}

// Parse arrow function expression with given parameters.

export function parseArrowExpression(parser: Parser, node, params, isAsync, forInit) {
  let oldYieldPos = parser.yieldPos,
    oldAwaitPos = parser.awaitPos,
    oldAwaitIdentPos = parser.awaitIdentPos;

  enterScope(parser, functionFlags(isAsync, false) | SCOPE_ARROW);
  initFunction(parser, node);
  if (parser.options.ecmaVersion >= 8) node.async = !!isAsync;

  parser.yieldPos = 0;
  parser.awaitPos = 0;
  parser.awaitIdentPos = 0;

  node.params = toAssignableList(parser, params, true);
  parseFunctionBody(parser, node, true, false, forInit);

  parser.yieldPos = oldYieldPos;
  parser.awaitPos = oldAwaitPos;
  parser.awaitIdentPos = oldAwaitIdentPos;
  return finishNode(parser, node, "ArrowFunctionExpression");
}

// Parse function body and check parameters.

export function parseFunctionBody(parser: Parser, node, isArrowFunction, isMethod, forInit) {
  let isExpression = isArrowFunction && parser.type !== tt.braceL;
  let oldStrict = parser.strict,
    useStrict = false;

  if (isExpression) {
    node.body = parseMaybeAssign(parser, forInit);
    node.expression = true;
    checkParams(parser, node, false);
  } else {
    let nonSimple = parser.options.ecmaVersion >= 7 && !isSimpleParamList(parser, node.params);
    if (!oldStrict || nonSimple) {
      useStrict = strictDirective(parser, parser.end);
      // If parser is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      if (useStrict && nonSimple)
        raiseRecoverable(
          parser,
          node.start,
          "Illegal 'use strict' directive in function with non-simple parameter list",
        );
    }
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    let oldLabels = parser.labels;
    parser.labels = [];
    if (useStrict) parser.strict = true;

    // Add the params to varDeclaredNames to ensure that an error is thrown
    // if a let/const declaration in the function clashes with one of the params.
    checkParams(
      parser,
      node,
      !oldStrict &&
        !useStrict &&
        !isArrowFunction &&
        !isMethod &&
        isSimpleParamList(parser, node.params),
    );
    // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
    if (parser.strict && node.id) checkLValSimple(parser, node.id, BIND_OUTSIDE);
    node.body = parseBlock(parser, false, undefined, useStrict && !oldStrict);
    node.expression = false;
    adaptDirectivePrologue(parser, node.body.body);
    parser.labels = oldLabels;
  }
  exitScope(parser);
}

export function isSimpleParamList(parser: Parser, params) {
  for (let param of params) if (param.type !== "Identifier") return false;
  return true;
}

// Checks function params for various disallowed patterns such as using "eval"
// or "arguments" and duplicate parameters.

export function checkParams(parser: Parser, node, allowDuplicates) {
  let nameHash = Object.create(null);
  for (let param of node.params)
    checkLValInnerPattern(parser, param, BIND_VAR, allowDuplicates ? null : nameHash);
}

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).

export function parseExprList(
  parser: Parser,
  close,
  allowTrailingComma,
  allowEmpty,
  refDestructuringErrors,
) {
  let elts = [],
    first = true;
  while (!eat(parser, close)) {
    if (!first) {
      expect(parser, tt.comma);
      if (allowTrailingComma && afterTrailingComma(parser, close)) break;
    } else first = false;

    let elt;
    if (allowEmpty && parser.type === tt.comma) elt = null;
    else if (parser.type === tt.ellipsis) {
      elt = parseSpread(parser, refDestructuringErrors);
      if (
        refDestructuringErrors &&
        parser.type === tt.comma &&
        refDestructuringErrors.trailingComma < 0
      )
        refDestructuringErrors.trailingComma = parser.start;
    } else {
      elt = parseMaybeAssign(parser, false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts;
}

export function checkUnreserved(parser: Parser, { start, end, name }) {
  if (parser.inGenerator && name === "yield")
    raiseRecoverable(parser, start, "Cannot use 'yield' as identifier inside a generator");
  if (parser.inAsync && name === "await")
    raiseRecoverable(parser, start, "Cannot use 'await' as identifier inside an async function");
  if (!(currentparserScope(parser).flags & SCOPE_VAR) && name === "arguments")
    raiseRecoverable(parser, start, "Cannot use 'arguments' in class field initializer");
  if (parser.inClassStaticBlock && (name === "arguments" || name === "await"))
    raise(parser, start, `Cannot use ${name} in class static initialization block`);
  if (parser.keywords.test(name)) raise(parser, start, `Unexpected keyword '${name}'`);
  if (parser.options.ecmaVersion < 6 && parser.input.slice(start, end).indexOf("\\") !== -1) return;
  const re = parser.strict ? parser.reservedWordsStrict : parser.reservedWords;
  if (re.test(name)) {
    if (!parser.inAsync && name === "await")
      raiseRecoverable(parser, start, "Cannot use keyword 'await' outside an async function");
    raiseRecoverable(parser, start, `The keyword '${name}' is reserved`);
  }
}

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.

export function parseIdent(parser: Parser, liberal = false) {
  let node = parseIdentNode(parser);
  next(parser, !!liberal);
  finishNode(parser, node, "Identifier");
  if (!liberal) {
    checkUnreserved(parser, node);
    if (node.name === "await" && !parser.awaitIdentPos) parser.awaitIdentPos = node.start;
  }
  return node;
}

export function parseIdentNode(parser: Parser) {
  let node = startNode(parser);
  if (parser.type === tt.name) {
    node.name = parser.value;
  } else if (parser.type.keyword) {
    node.name = parser.type.keyword;

    // To fix https://github.com/acornjs/acorn/issues/575
    // `class` and `function` keywords push new context into parser.context.
    // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
    // If the previous token is a dot, parser does not apply because the context-managing code already ignored the keyword
    if (
      (node.name === "class" || node.name === "function") &&
      (parser.lastTokEnd !== parser.lastTokStart + 1 ||
        parser.input.charCodeAt(parser.lastTokStart) !== 46)
    ) {
      parser.context.pop();
    }
    parser.type = tt.name;
  } else {
    unexpected(parser);
  }
  return node;
}

export function parsePrivateIdent(parser: Parser) {
  const node = startNode(parser);
  if (parser.type === tt.privateId) {
    node.specific = { type: "PrivateIdentifier", name: parser.value! };
  } else {
    unexpected(parser);
  }
  next(parser);

  finishNode(parser, node, "PrivateIdentifier");

  // For validating existence
  if (parser.options.checkPrivateFields) {
    if (parser.privateNameStack.length === 0) {
      raise(
        parser,
        node.start,
        `Private field '#${node.name}' must be declared in an enclosing class`,
      );
    } else {
      parser.privateNameStack[parser.privateNameStack.length - 1].used.push(node);
    }
  }

  return node;
}

// Parses yield expression inside generator.

export function parseYield(parser: Parser, forInit) {
  if (!parser.yieldPos) parser.yieldPos = parser.start;

  let node = startNode(parser);
  next(parser);
  if (
    parser.type === tt.semi ||
    canInsertSemicolon(parser) ||
    (parser.type !== tt.star && !parser.type.startsExpr)
  ) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = eat(parser, tt.star);
    node.argument = parseMaybeAssign(parser, forInit);
  }
  return finishNode(parser, node, "YieldExpression");
}

export function parseAwait(parser: Parser, forInit) {
  if (!parser.awaitPos) parser.awaitPos = parser.start;

  let node = startNode(parser);
  next(parser);
  node.argument = parseMaybeUnary(parser, null, true, false, forInit);
  return finishNode(parser, node, "AwaitExpression");
}
