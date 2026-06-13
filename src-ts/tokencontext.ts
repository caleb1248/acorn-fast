// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design

import type { Parser } from "./state";
import { types as tt, type TokenType } from "./tokentype.js";
import { tryReadTemplateToken } from "./tokenize.js";
import { lineBreak } from "./whitespace.js";

export class TokContext {
  public token: string;
  public isExpr: boolean;
  public preserveSpace: boolean;
  public override?: ((parser: Parser) => void) | null;
  public generator: boolean;

  constructor(
    token: string,
    isExpr: boolean,
    preserveSpace?: boolean,
    override?: ((parser: Parser) => void) | null,
    generator?: boolean,
  ) {
    this.token = token;
    this.isExpr = !!isExpr;
    this.preserveSpace = !!preserveSpace;
    this.override = override;
    this.generator = !!generator;
  }
}

export const types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, (p) => tryReadTemplateToken(p)),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true),
};

export function initialContext() {
  return [types.b_stat];
}

export function curContext(parser: Parser) {
  return parser.context[parser.context.length - 1];
}

export function braceIsBlock(parser: Parser, prevType: TokenType) {
  let parent = curContext(parser);
  if (parent === types.f_expr || parent === types.f_stat) return true;
  if (
    prevType === tt.colon &&
    (parent === types.b_stat || parent === types.b_expr)
  )
    return !parent.isExpr;

  // The check for `tt.name && exprAllowed` detects whether we are
  // after a `yield` or `of` construct. See the `updateContext` for
  // `tt.name`.
  if (prevType === tt._return || (prevType === tt.name && parser.exprAllowed))
    return lineBreak.test(parser.input.slice(parser.lastTokEnd, parser.start));
  if (
    prevType === tt._else ||
    prevType === tt.semi ||
    prevType === tt.eof ||
    prevType === tt.parenR ||
    prevType === tt.arrow
  )
    return true;
  if (prevType === tt.braceL) return parent === types.b_stat;
  if (prevType === tt._var || prevType === tt._const || prevType === tt.name)
    return false;

  return !parser.exprAllowed;
}

export function inGeneratorContext(parser: Parser) {
  for (let i = parser.context.length - 1; i >= 1; i--) {
    let context = parser.context[i];
    if (context.token === "function") return context.generator;
  }
  return false;
}

export function updateContext(parser: Parser, prevType: TokenType) {
  let update,
    type = parser.type;
  if (type.keyword && prevType === tt.dot) parser.exprAllowed = false;
  else if ((update = type.updateContext)) update(parser, prevType);
  else parser.exprAllowed = type.beforeExpr;
}

// Used to handle edge cases when token context could not be inferred correctly during tokenization phase

export function overrideContext(parser: Parser, tokenCtx: TokContext) {
  if (curContext(parser) !== tokenCtx) {
    parser.context[parser.context.length - 1] = tokenCtx;
  }
}

// Token-specific context update code

tt.parenR.updateContext = tt.braceR.updateContext = function (parser) {
  if (parser.context.length === 1) {
    parser.exprAllowed = true;
    return;
  }

  let out = parser.context.pop();

  if (out === types.b_stat && curContext(parser).token === "function") {
    out = parser.context.pop();
  }

  parser.exprAllowed = !out?.isExpr;
};

tt.braceL.updateContext = function (parser, prevType) {
  parser.context.push(
    braceIsBlock(parser, prevType) ? types.b_stat : types.b_expr,
  );

  parser.exprAllowed = true;
};

tt.dollarBraceL.updateContext = function (parser) {
  parser.context.push(types.b_tmpl);
  parser.exprAllowed = true;
};

tt.parenL.updateContext = function (parser, prevType) {
  let statementParens =
    prevType === tt._if ||
    prevType === tt._for ||
    prevType === tt._with ||
    prevType === tt._while;

  parser.context.push(statementParens ? types.p_stat : types.p_expr);
  parser.exprAllowed = true;
};

tt.incDec.updateContext = function () {
  // tokExprAllowed stays unchanged
};

tt._function.updateContext = tt._class.updateContext = function (
  parser,
  prevType,
) {
  if (
    prevType.beforeExpr &&
    prevType !== tt._else &&
    !(prevType === tt.semi && curContext(parser) !== types.p_stat) &&
    !(
      prevType === tt._return &&
      lineBreak.test(parser.input.slice(parser.lastTokEnd, parser.start))
    ) &&
    !(
      (prevType === tt.colon || prevType === tt.braceL) &&
      curContext(parser) === types.b_stat
    )
  )
    parser.context.push(types.f_expr);
  else parser.context.push(types.f_stat);
  parser.exprAllowed = false;
};

tt.colon.updateContext = function (parser) {
  if (curContext(parser).token === "function") parser.context.pop();
  parser.exprAllowed = true;
};

tt.backQuote.updateContext = function (parser) {
  if (curContext(parser) === types.q_tmpl) parser.context.pop();
  else parser.context.push(types.q_tmpl);
  parser.exprAllowed = false;
};

tt.star.updateContext = function (parser, prevType) {
  if (prevType === tt._function) {
    let index = parser.context.length - 1;
    if (parser.context[index] === types.f_expr)
      parser.context[index] = types.f_expr_gen;
    else parser.context[index] = types.f_gen;
  }
  parser.exprAllowed = true;
};

tt.name.updateContext = function (parser, prevType) {
  let allowed = false;
  if (parser.options.ecmaVersion >= 6 && prevType !== tt.dot) {
    if (
      (parser.value === "of" && !parser.exprAllowed) ||
      (parser.value === "yield" && inGeneratorContext(parser))
    )
      allowed = true;
  }
  parser.exprAllowed = allowed;
};
