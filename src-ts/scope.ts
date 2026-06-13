import type { Parser } from "./state";
import {
  SCOPE_VAR,
  SCOPE_FUNCTION,
  SCOPE_TOP,
  SCOPE_ARROW,
  SCOPE_SIMPLE_CATCH,
  BIND_LEXICAL,
  BIND_SIMPLE_CATCH,
  BIND_FUNCTION,
  SCOPE_CLASS_FIELD_INIT,
  SCOPE_CLASS_STATIC_BLOCK,
} from "./scopeflags.js";
import { raiseRecoverable } from "./location";
import { Identifier } from "./acorn";

type Flags = number;

export class Scope {
  public flags: Flags;
  var: string[];
  lexical: string[];
  functions: string[];

  constructor(flags: Flags) {
    this.flags = flags;
    // A list of var-declared names in the current lexical scope
    this.var = [];
    // A list of lexically-declared names in the current lexical scope
    this.lexical = [];
    // A list of lexically-declared FunctionDeclaration names in the current lexical scope
    this.functions = [];
  }
}

// The functions in this module keep track of declared variables in the current scope in order to detect duplicate variable names.

export function enterScope(parser: Parser, flags: Flags) {
  parser.scopeStack.push(new Scope(flags));
}

export function exitScope(parser: Parser) {
  parser.scopeStack.pop();
}

// The spec says:
// > At the top level of a function, or script, function declarations are
// > treated like var declarations rather than like lexical declarations.
export function treatFunctionsAsVarInScope(parser: Parser, scope: Scope) {
  return (
    scope.flags & SCOPE_FUNCTION ||
    (!parser.inModule && scope.flags & SCOPE_TOP)
  );
}

export function declareName(
  parser: Parser,
  name: string,
  bindingType: number,
  pos: number,
) {
  let redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    const scope = currentScope(parser);
    redeclared =
      scope.lexical.indexOf(name) > -1 ||
      scope.functions.indexOf(name) > -1 ||
      scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (parser.inModule && scope.flags & SCOPE_TOP)
      delete parser.undefinedExports[name];
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    const scope = currentScope(parser);
    scope.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    const scope = currentScope(parser);
    if (parser.treatFunctionsAsVar)
      redeclared = scope.lexical.indexOf(name) > -1;
    else
      redeclared =
        scope.lexical.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.functions.push(name);
  } else {
    for (let i = parser.scopeStack.length - 1; i >= 0; --i) {
      const scope = parser.scopeStack[i];
      if (
        (scope.lexical.indexOf(name) > -1 &&
          !(scope.flags & SCOPE_SIMPLE_CATCH && scope.lexical[0] === name)) ||
        (!treatFunctionsAsVarInScope(parser, scope) &&
          scope.functions.indexOf(name) > -1)
      ) {
        redeclared = true;
        break;
      }
      scope.var.push(name);
      if (parser.inModule && scope.flags & SCOPE_TOP)
        delete parser.undefinedExports[name];
      if (scope.flags & SCOPE_VAR) break;
    }
  }
  if (redeclared)
    raiseRecoverable(
      parser,
      pos,
      `Identifier '${name}' has already been declared`,
    );
}

export function checkLocalExport(parser: Parser, id: Identifier) {
  // scope.functions must be empty as Module code is always strict.
  if (
    parser.scopeStack[0].lexical.indexOf(id.name) === -1 &&
    parser.scopeStack[0].var.indexOf(id.name) === -1
  ) {
    parser.undefinedExports[id.name] = id;
  }
}

export function currentScope(parser: Parser) {
  return parser.scopeStack[parser.scopeStack.length - 1];
}

export function currentVarScope(parser: Parser) {
  for (let i = parser.scopeStack.length - 1; ; i--) {
    let scope = parser.scopeStack[i];
    if (
      scope.flags &
      (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK)
    )
      return scope;
  }
}

// Could be useful for `this`, `new.target`, `super()`, `super.property`, and `super[property]`.
export function currentThisScope(parser: Parser) {
  for (let i = parser.scopeStack.length - 1; ; i--) {
    let scope = parser.scopeStack[i];

    if (
      scope.flags &
        (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK) &&
      !(scope.flags & SCOPE_ARROW)
    )
      return scope;
  }
}
