import { TokenType, types as tt } from "./tokentype";
import type { Parser } from "./state.js";
import { hasOwn } from "./util.js";
import { BIND_NONE, BIND_OUTSIDE, BIND_LEXICAL } from "./scopeflags.js";
import { Node, startNode, startNodeAt } from "./node";
import { raise, raiseRecoverable } from "./location";
import {
  afterTrailingComma,
  checkPatternErrors,
  DestructuringErrors,
  eat,
  expect,
  unexpected,
} from "./parseutil";
import { AnyNode, ObjectExpression, ObjectPattern } from "./acorn";
import { next } from "./tokenize";
import { parseIdent, parseMaybeAssign } from "./expression";
import { declareName } from "./scope";

// Convert existing expression atom to assignable pattern
// if possible.

type CheckClashes = Record<string, boolean>;

type Assignable<T extends AnyNode = AnyNode> = T extends ObjectExpression ? ObjectPattern : T;

/**
 * Warning: this function does not assign properties to `node` anymore.
 */
export function toAssignable(
  parser: Parser,
  node: Node,
  isBinding: boolean,
  refDestructuringErrors?: DestructuringErrors,
) {
  if (parser.options.ecmaVersion >= 6 && node) {
    switch (node.specific.type) {
      case "Identifier":
        if (parser.inAsync && node.specific.name === "await")
          raise(parser, node.start, "Cannot use 'await' as identifier inside an async function");
        return node;

      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        return node;

      case "ObjectExpression":
        const oldProperties = node.specific.properties;
        node.specific = { type: "ObjectPattern", properties: [] };
        if (refDestructuringErrors) checkPatternErrors(parser, refDestructuringErrors, true);
        for (let prop of oldProperties) {
          const assignable = toAssignable(parser, prop, isBinding);
          // Early error:
          //   AssignmentRestProperty[Yield, Await] :
          //     `...` DestructuringAssignmentTarget[Yield, Await]
          //
          //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
          if (
            assignable.specific.type === "RestElement" &&
            (assignable.specific.argument.type === "ArrayPattern" ||
              assignable.argument.type === "ObjectPattern")
          ) {
            raise(parser, assignable.argument.start, "Unexpected token");
          }
        }
        break;

      case "Property":
        // AssignmentProperty has type === "Property"
        if (node.specific.kind !== "init")
          raise(parser, node.specific.key.start, "Object pattern can't contain getter or setter");
        toAssignable(parser, node.specific.value, isBinding);
        break;

      case "ArrayExpression":
        if (refDestructuringErrors) checkPatternErrors(parser, refDestructuringErrors, true);

        return {
          ...node,
          specific: {
            type: "ArrayPattern",
            elements: toAssignableList(parser, node.specific.elements, isBinding),
          },
        };
        break;

      case "SpreadElement":
        node.type = "RestElement";
        toAssignable(parser, node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern")
          raise(parser, node.argument.start, "Rest elements cannot have a default value");
        break;

      case "AssignmentExpression":
        if (node.operator !== "=")
          raise(
            parser,
            node.left.end,
            "Only '=' operator can be used for specifying default value.",
          );
        node.type = "AssignmentPattern";
        delete node.operator;
        toAssignable(parser, node.left, isBinding);
        break;

      case "ParenthesizedExpression":
        toAssignable(parser, node.expression, isBinding, refDestructuringErrors);
        break;

      case "ChainExpression":
        raiseRecoverable(parser, node.start, "Optional chaining cannot appear in left-hand side");
        break;

      case "MemberExpression":
        if (!isBinding) break;

      default:
        raise(parser, node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) checkPatternErrors(parser, refDestructuringErrors, true);
  return node;
}

// Convert list of expression atoms to binding list.

export function toAssignableList(
  parser: Parser,
  exprList: (Node<AnyNode> | null)[],
  isBinding: boolean,
) {
  let end = exprList.length;
  for (let i = 0; i < end; i++) {
    let elt = exprList[i];
    if (elt) toAssignable(parser, elt, isBinding);
  }
  if (end) {
    let last = exprList[end - 1];
    if (
      parser.options.ecmaVersion === 6 &&
      isBinding &&
      last &&
      last.type === "RestElement" &&
      last.argument.type !== "Identifier"
    )
      unexpected(parser, last.argument.start);
  }
  return exprList;
}

// Parses spread element.

export function parseSpread(parser: Parser, refDestructuringErrors: DestructuringErrors) {
  let node = startNode(parser);
  next(parser);
  node.argument = parseMaybeAssign(parser, false, refDestructuringErrors);
  return finishNode(parser, node, "SpreadElement");
}

export function parseRestBinding(parser: Parser) {
  let node = startNode(parser);
  next(parser);

  // RestElement inside of a function parameter must be an identifier
  if (parser.options.ecmaVersion === 6 && parser.type !== tt.name) unexpected(parser);

  node.argument = parseBindingAtom(parser);

  return finishNode(parser, node, "RestElement");
}

// Parses lvalue (assignable) atom.

export function parseBindingAtom(parser: Parser) {
  if (parser.options.ecmaVersion >= 6) {
    switch (parser.type) {
      case tt.bracketL:
        let node = startNode(parser);
        next(parser);
        node.elements = parseBindingList(parser, tt.bracketR, true, true);
        return finishNode(parser, node, "ArrayPattern");

      case tt.braceL:
        return parseObj(parser, true);
    }
  }
  return parseIdent(parser);
}

/**
 * @param allowModifiers - unused?
 */
export function parseBindingList(
  parser: Parser,
  close: TokenType,
  allowEmpty,
  allowTrailingComma,
  allowModifiers = false,
) {
  let elts = [],
    first = true;
  while (!eat(parser, close)) {
    if (first) first = false;
    else expect(parser, tt.comma);
    if (allowEmpty && parser.type === tt.comma) {
      elts.push(null);
    } else if (allowTrailingComma && afterTrailingComma(parser, close)) {
      break;
    } else if (parser.type === tt.ellipsis) {
      let rest = parseRestBinding(parser);
      parseBindingListItem(parser, rest);
      elts.push(rest);
      if (parser.type === tt.comma)
        raiseRecoverable(parser, parser.start, "Comma is not permitted after the rest element");
      expect(parser, close);
      break;
    } else {
      elts.push(parseAssignableListItem(parser, allowModifiers));
    }
  }
  return elts;
}

export function parseAssignableListItem(parser: Parser, _allowModifiers = false) {
  let elem = parseMaybeDefault(parser, parser.start, parser.startLoc);
  parseBindingListItem(parser, elem);
  return elem;
}

export function parseBindingListItem(parser: Parser, param) {
  return param;
}

// Parses assignment pattern around given atom if possible.

export function parseMaybeDefault(parser: Parser, startPos, startLoc, left) {
  left = left || parseBindingAtom(parser);
  if (parser.options.ecmaVersion < 6 || !eat(parser, tt.eq)) return left;
  let node = startNodeAt(parser, startPos, startLoc);
  node.left = left;
  node.right = parseMaybeAssign(parser);
  return finishNode(parser, node, "AssignmentPattern");
}

// The following three functions all verify that a node is an lvalue —
// something that can be bound, or assigned to. In order to do so, they perform
// a variety of checks:
//
// - Check that none of the bound/assigned-to identifiers are reserved words.
// - Record name declarations for bindings in the appropriate scope.
// - Check duplicate argument names, if checkClashes is set.
//
// If a complex binding pattern is encountered (e.g., object and array
// destructuring), the entire pattern is recursively checked.
//
// There are three versions of checkLVal*() appropriate for different
// circumstances:
//
// - checkLValSimple() shall be used if the syntactic construct supports
//   nothing other than identifiers and member expressions. Parenthesized
//   expressions are also correctly handled. parser is generally appropriate for
//   constructs for which the spec says
//
//   > It is a Syntax Error if AssignmentTargetType of [the production] is not
//   > simple.
//
//   It is also appropriate for checking if an identifier is valid and not
//   defined elsewhere, like import declarations or function/class identifiers.
//
//   Examples where parser is used include:
//     a += …;
//     import a from '…';
//   where a is the node to be checked.
//
// - checkLValPattern() shall be used if the syntactic construct supports
//   anything checkLValSimple() supports, as well as object and array
//   destructuring patterns. parser is generally appropriate for constructs for
//   which the spec says
//
//   > It is a Syntax Error if [the production] is neither an ObjectLiteral nor
//   > an ArrayLiteral and AssignmentTargetType of [the production] is not
//   > simple.
//
//   Examples where parser is used include:
//     (a = …);
//     const a = …;
//     try { … } catch (a) { … }
//   where a is the node to be checked.
//
// - checkLValInnerPattern() shall be used if the syntactic construct supports
//   anything checkLValPattern() supports, as well as default assignment
//   patterns, rest elements, and other constructs that may appear within an
//   object or array destructuring pattern.
//
//   As a special case, function parameters also use checkLValInnerPattern(),
//   as they also support defaults and rest constructs.
//
// These functions deliberately support both assignment and binding constructs,
// as the logic for both is exceedingly similar. If the node is the target of
// an assignment, then bindingType should be set to BIND_NONE. Otherwise, it
// should be set to the appropriate BIND_* constant, like BIND_VAR or
// BIND_LEXICAL.
//
// If the function is called with a non-BIND_NONE bindingType, then
// additionally a checkClashes object may be specified to allow checking for
// duplicate argument names. checkClashes is ignored if the provided construct
// is an assignment (i.e., bindingType is BIND_NONE).

export function checkLValSimple(
  parser: Parser,
  expr: AnyNode,
  bindingType = BIND_NONE,
  checkClashes: CheckClashes,
) {
  const isBind = bindingType !== BIND_NONE;

  switch (expr.type) {
    case "Identifier":
      if (parser.strict && parser.reservedWordsStrictBind.test(expr.name))
        raiseRecoverable(
          parser,
          expr.start,
          (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode",
        );
      if (isBind) {
        if (bindingType === BIND_LEXICAL && expr.name === "let")
          raiseRecoverable(parser, expr.start, "let is disallowed as a lexically bound name");
        if (checkClashes) {
          if (hasOwn(checkClashes, expr.name))
            raiseRecoverable(parser, expr.start, "Argument name clash");
          checkClashes[expr.name] = true;
        }
        if (bindingType !== BIND_OUTSIDE) declareName(parser, expr.name, bindingType, expr.start);
      }
      break;

    case "ChainExpression":
      raiseRecoverable(parser, expr.start, "Optional chaining cannot appear in left-hand side");
      break;

    case "MemberExpression":
      if (isBind) raiseRecoverable(parser, expr.start, "Binding member expression");
      break;

    case "ParenthesizedExpression":
      if (isBind) raiseRecoverable(parser, expr.start, "Binding parenthesized expression");
      return checkLValSimple(parser, expr.expression, bindingType, checkClashes);

    default:
      raise(parser, expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
}

export function checkLValPattern(
  parser: Parser,
  expr: AnyNode,
  bindingType = BIND_NONE,
  checkClashes: CheckClashes,
) {
  switch (expr.type) {
    case "ObjectPattern":
      for (let prop of expr.properties) {
        checkLValInnerPattern(parser, prop, bindingType, checkClashes);
      }
      break;

    case "ArrayPattern":
      for (let elem of expr.elements) {
        if (elem) checkLValInnerPattern(parser, elem, bindingType, checkClashes);
      }
      break;

    default:
      checkLValSimple(parser, expr, bindingType, checkClashes);
  }
}

export function checkLValInnerPattern(
  parser: Parser,
  expr: AnyNode,
  bindingType = BIND_NONE,
  checkClashes: CheckClashes,
) {
  switch (expr.type) {
    case "Property":
      // AssignmentProperty has type === "Property"
      checkLValInnerPattern(parser, expr.value, bindingType, checkClashes);
      break;

    case "AssignmentPattern":
      checkLValPattern(parser, expr.left, bindingType, checkClashes);
      break;

    case "RestElement":
      checkLValPattern(parser, expr.argument, bindingType, checkClashes);
      break;

    default:
      checkLValPattern(parser, expr, bindingType, checkClashes);
  }
}
