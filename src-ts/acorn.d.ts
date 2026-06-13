// @ts-check

type Option<T> = T | null | undefined;

export interface Node<T extends AnyNode = AnyNode> {
  start: number;
  end: number;
  range?: Option<[number, number]>;
  loc?: Option<SourceLocation>;
  /**
   * Properties specific to the type of node, suh as the properties in `Identifier`.
   */
  specific: T;
}

export interface UnknownNode {
  type: "";
}

export interface SourceLocation {
  source?: Option<string>;
  start: Position;
  end: Position;
}

export interface Position {
  /** 1-based */
  line: number;
  /** 0-based */
  column: number;
}

export interface Identifier {
  type: "Identifier";
  name: string;
}

export interface Literal {
  type: "Literal";
  value?: Option<string | boolean | number | RegExp | bigint>;
  raw?: string;
  regex?: {
    pattern: string;
    flags: string;
  };
  bigint?: string;
}

export interface Program {
  type: "Program";
  body: Array<Node<Statement | ModuleDeclaration>>;
  sourceType: "script" | "module";
}

export interface Function {
  id?: Option<Node<Identifier>>;
  params: Array<Node<Pattern>>;
  body: Node<BlockStatement | Expression>;
  generator: boolean;
  expression: boolean;
  async: boolean;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: Node<Expression | Literal>;
  directive?: Option<string>;
}

export interface BlockStatement {
  type: "BlockStatement";
  body: Array<Node<Statement>>;
}

export interface EmptyStatement {
  type: "EmptyStatement";
}

export interface DebuggerStatement {
  type: "DebuggerStatement";
}

export interface WithStatement {
  type: "WithStatement";
  object: Node<Expression>;
  body: Node<Statement>;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  argument?: Option<Node<Expression>>;
}

export interface LabeledStatement {
  type: "LabeledStatement";
  label: Node<Identifier>;
  body: Node<Statement>;
}

export interface BreakStatement {
  type: "BreakStatement";
  label?: Option<Node<Identifier>>;
}

export interface ContinueStatement {
  type: "ContinueStatement";
  label?: Option<Node<Identifier>>;
}

export interface IfStatement {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate?: Option<Statement>;
}

export interface SwitchStatement {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: Array<Node<SwitchCase>>;
}

export interface SwitchCase {
  type: "SwitchCase";
  test?: Option<Node<Expression>>;
  consequent: Array<Node<Statement>>;
}

export interface ThrowStatement {
  type: "ThrowStatement";
  argument: Node<Expression>;
}

export interface TryStatement {
  type: "TryStatement";
  block: Node<BlockStatement>;
  handler?: Option<Node<CatchClause>>;
  finalizer?: Option<Node<BlockStatement>>;
}

export interface CatchClause {
  type: "CatchClause";
  param?: Option<Node<Pattern>>;
  body: Node<BlockStatement>;
}

export interface WhileStatement {
  type: "WhileStatement";
  test: Node<Expression>;
  body: Node<Statement>;
}

export interface DoWhileStatement {
  type: "DoWhileStatement";
  body: Node<Statement>;
  test: Node<Expression>;
}

export interface ForStatement {
  type: "ForStatement";
  init?: Option<Node<VariableDeclaration | Expression>>;
  test?: Option<Node<Expression>>;
  update?: Option<Node<Expression>>;
  body: Node<Statement>;
}

export interface ForInStatement {
  type: "ForInStatement";
  left: Node<VariableDeclaration | Pattern>;
  right: Node<Expression>;
  body: Node<Statement>;
}

export interface FunctionDeclaration extends Function {
  type: "FunctionDeclaration";
  id: Node<Identifier>;
  body: Node<BlockStatement>;
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  declarations: Array<Node<VariableDeclarator>>;
  kind: "var" | "let" | "const" | "using" | "await using";
}

export interface VariableDeclarator {
  type: "VariableDeclarator";
  id: Node<Pattern>;
  init?: Option<Node<Expression>>;
}

export interface ThisExpression {
  type: "ThisExpression";
}

export interface ArrayExpression {
  type: "ArrayExpression";
  elements: Array<Node<Expression> | Node<SpreadElement> | null>;
}

export interface ObjectExpression {
  type: "ObjectExpression";
  properties: Array<Node<Property | SpreadElement>>;
}

export interface Property {
  type: "Property";
  key: Node<Expression>;
  value: Node<Expression>;
  kind: "init" | "get" | "set";
  method: boolean;
  shorthand: boolean;
  computed: boolean;
}

export interface FunctionExpression extends Function {
  type: "FunctionExpression";
  body: Node<BlockStatement>;
}

export interface UnaryExpression {
  type: "UnaryExpression";
  operator: UnaryOperator;
  prefix: boolean;
  argument: Node<Expression>;
}

export type UnaryOperator = "-" | "+" | "!" | "~" | "typeof" | "void" | "delete";

export interface UpdateExpression {
  type: "UpdateExpression";
  operator: UpdateOperator;
  argument: Node<Expression>;
  prefix: boolean;
}

export type UpdateOperator = "++" | "--";

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Node<Expression | PrivateIdentifier>;
  right: Node<Expression>;
}

export type BinaryOperator =
  | "=="
  | "!="
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "<<"
  | ">>"
  | ">>>"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "|"
  | "^"
  | "&"
  | "in"
  | "instanceof"
  | "**";

export interface AssignmentExpression {
  type: "AssignmentExpression";
  operator: AssignmentOperator;
  left: Node<Pattern>;
  right: Node<Expression>;
}

export type AssignmentOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "<<="
  | ">>="
  | ">>>="
  | "|="
  | "^="
  | "&="
  | "**="
  | "||="
  | "&&="
  | "??=";

export interface LogicalExpression {
  type: "LogicalExpression";
  operator: LogicalOperator;
  left: Node<Expression>;
  right: Node<Expression>;
}

export type LogicalOperator = "||" | "&&" | "??";

export interface MemberExpression {
  type: "MemberExpression";
  object: Node<Expression | Super>;
  property: Node<Expression | PrivateIdentifier>;
  computed: boolean;
  optional: boolean;
}

export interface ConditionalExpression {
  type: "ConditionalExpression";
  test: Node<Expression>;
  alternate: Node<Expression>;
  consequent: Node<Expression>;
}

export interface CallExpression {
  type: "CallExpression";
  callee: Node<Expression | Super>;
  arguments: Array<Node<Expression | SpreadElement>>;
  optional: boolean;
}

export interface NewExpression {
  type: "NewExpression";
  callee: Node<Expression>;
  arguments: Array<Node<Expression | SpreadElement>>;
}

export interface SequenceExpression {
  type: "SequenceExpression";
  expressions: Array<Node<Expression>>;
}

export interface ForOfStatement {
  type: "ForOfStatement";
  left: Node<VariableDeclaration | Pattern>;
  right: Node<Expression>;
  body: Node<Statement>;
  await: boolean;
}

export interface Super {
  type: "Super";
}

export interface SpreadElement {
  type: "SpreadElement";
  argument: Node<Expression>;
}

export interface ArrowFunctionExpression extends Function {
  type: "ArrowFunctionExpression";
}

export interface YieldExpression {
  type: "YieldExpression";
  argument?: Option<Node<Expression>>;
  delegate: boolean;
}

export interface TemplateLiteral {
  type: "TemplateLiteral";
  quasis: Array<TemplateElement>;
  expressions: Array<Node<Expression>>;
}

export interface TaggedTemplateExpression {
  type: "TaggedTemplateExpression";
  tag: Node<Expression>;
  quasi: Node<TemplateLiteral>;
}

export interface TemplateElement {
  type: "TemplateElement";
  tail: boolean;
  value: {
    cooked?: Option<string>;
    raw: string;
  };
}

export interface AssignmentProperty {
  type: "Property";
  key: Node<Expression>;
  value: Node<Pattern>;
  kind: "init";
  method: false;
  shorthand: boolean;
  computed: boolean;
}

export interface ObjectPattern {
  type: "ObjectPattern";
  properties: Array<Node<AssignmentProperty | RestElement>>;
}

export interface ArrayPattern {
  type: "ArrayPattern";
  elements: Array<Option<Node<Pattern>>>;
}

export interface RestElement {
  type: "RestElement";
  argument: Node<Pattern>;
}

export interface AssignmentPattern {
  type: "AssignmentPattern";
  left: Node<Pattern>;
  right: Node<Expression>;
}

export interface Class {
  id?: Option<Node<Identifier>>;
  superClass?: Option<Node<Expression>>;
  body: Node<ClassBody>;
}

export interface ClassBody {
  type: "ClassBody";
  body: Array<Node<MethodDefinition | PropertyDefinition | StaticBlock>>;
}

export interface MethodDefinition {
  type: "MethodDefinition";
  key: Node<Expression> | Node<PrivateIdentifier>;
  value: Node<FunctionExpression>;
  kind: "constructor" | "method" | "get" | "set";
  computed: boolean;
  static: boolean;
}

export interface ClassDeclaration extends Class {
  type: "ClassDeclaration";
  id: Node<Identifier>;
}

export interface ClassExpression extends Class {
  type: "ClassExpression";
}

export interface MetaProperty {
  type: "MetaProperty";
  meta: Node<Identifier>;
  property: Node<Identifier>;
}

export interface ImportDeclaration {
  type: "ImportDeclaration";
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
  source: Node<Literal>;
  attributes: Array<ImportAttribute>;
}

export interface ImportSpecifier {
  type: "ImportSpecifier";
  imported: Node<Identifier | Literal>;
  local: Node<Identifier>;
}

export interface ImportDefaultSpecifier {
  type: "ImportDefaultSpecifier";
  local: Node<Identifier>;
}

export interface ImportNamespaceSpecifier {
  type: "ImportNamespaceSpecifier";
  local: Node<Identifier>;
}

export interface ImportAttribute {
  type: "ImportAttribute";
  key: Node<Identifier | Literal>;
  value: Node<Literal>;
}

export interface ExportNamedDeclaration {
  type: "ExportNamedDeclaration";
  declaration?: Option<Node<Declaration>>;
  specifiers: Array<Node<ExportSpecifier>>;
  source?: Option<Node<Literal>>;
  attributes: Array<Node<ImportAttribute>>;
}

export interface ExportSpecifier {
  type: "ExportSpecifier";
  exported: Node<Identifier | Literal>;
  local: Node<Identifier | Literal>;
}

export interface AnonymousFunctionDeclaration extends Function {
  type: "FunctionDeclaration";
  id: null;
  body: Node<BlockStatement>;
}

export interface AnonymousClassDeclaration extends Class {
  type: "ClassDeclaration";
  id: null;
}

export interface ExportDefaultDeclaration {
  type: "ExportDefaultDeclaration";
  declaration: Node<
    | AnonymousFunctionDeclaration
    | FunctionDeclaration
    | AnonymousClassDeclaration
    | ClassDeclaration
    | Expression
  >;
}

export interface ExportAllDeclaration {
  type: "ExportAllDeclaration";
  source: Node<Literal>;
  exported?: Option<Node<Identifier | Literal>>;
  attributes: Array<Node<ImportAttribute>>;
}

export interface AwaitExpression {
  type: "AwaitExpression";
  argument: Node<Expression>;
}

export interface ChainExpression {
  type: "ChainExpression";
  expression: Node<MemberExpression> | Node<CallExpression>;
}

export interface ImportExpression {
  type: "ImportExpression";
  source: Node<Expression>;
  options?: Option<Node<Expression>>;
}

export interface ParenthesizedExpression {
  type: "ParenthesizedExpression";
  expression: Node<Expression>;
}

export interface PropertyDefinition {
  type: "PropertyDefinition";
  key: Node<Expression> | Node<PrivateIdentifier>;
  value?: Option<Node<Expression>>;
  computed: boolean;
  static: boolean;
}

export interface PrivateIdentifier {
  type: "PrivateIdentifier";
  name: string;
}

export interface StaticBlock {
  type: "StaticBlock";
  body: Array<Node<Statement>>;
}

export type Statement =
  | ExpressionStatement
  | BlockStatement
  | EmptyStatement
  | DebuggerStatement
  | WithStatement
  | ReturnStatement
  | LabeledStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement
  | SwitchStatement
  | ThrowStatement
  | TryStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForInStatement
  | ForOfStatement
  | Declaration;

export type Declaration = FunctionDeclaration | VariableDeclaration | ClassDeclaration;

export type Expression =
  | Identifier
  | Literal
  | ThisExpression
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | AssignmentExpression
  | LogicalExpression
  | MemberExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | SequenceExpression
  | ArrowFunctionExpression
  | YieldExpression
  | TemplateLiteral
  | TaggedTemplateExpression
  | ClassExpression
  | MetaProperty
  | AwaitExpression
  | ChainExpression
  | ImportExpression
  | ParenthesizedExpression;

export type Pattern =
  | Identifier
  | MemberExpression
  | ObjectPattern
  | ArrayPattern
  | RestElement
  | AssignmentPattern;

export type ModuleDeclaration =
  | ImportDeclaration
  | ExportNamedDeclaration
  | ExportDefaultDeclaration
  | ExportAllDeclaration;

/**
 * This interface is only used for defining {@link AnyNode}.
 * It exists so that it can be extended by plugins:
 *
 * @example
 * ```typescript
 * declare module 'acorn' {
 *   interface NodeTypes {
 *     pluginName: FirstNode | SecondNode | ThirdNode | ... | LastNode
 *   }
 * }
 * ```
 */
interface NodeTypes {
  core:
    | Statement
    | Expression
    | Declaration
    | ModuleDeclaration
    | Literal
    | Program
    | SwitchCase
    | CatchClause
    | Property
    | Super
    | SpreadElement
    | TemplateElement
    | AssignmentProperty
    | ObjectPattern
    | ArrayPattern
    | RestElement
    | AssignmentPattern
    | ClassBody
    | MethodDefinition
    | MetaProperty
    | ImportAttribute
    | ImportSpecifier
    | ImportDefaultSpecifier
    | ImportNamespaceSpecifier
    | ExportSpecifier
    | AnonymousFunctionDeclaration
    | AnonymousClassDeclaration
    | PropertyDefinition
    | PrivateIdentifier
    | StaticBlock
    | VariableDeclarator
    | UnknownNode;
}

export type AnyNode = NodeTypes[keyof NodeTypes];

export function parse(input: string, options: Options): Program;

export function parseExpressionAt(input: string, pos: number, options: Options): Expression;

export function tokenizer(
  input: string,
  options: Options,
): {
  getToken(): Token;
  [Symbol.iterator](): Iterator<Token>;
};

export type ecmaVersion =
  | 3
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 2015
  | 2016
  | 2017
  | 2018
  | 2019
  | 2020
  | 2021
  | 2022
  | 2023
  | 2024
  | 2025
  | 2026
  | "latest";

/**
 * User-facing interface for the parser options.
 */
export interface ExternalOptions {
  /**
   * `ecmaVersion` indicates the ECMAScript version to parse. Can be a
   * number, either in year (`2022`) or plain version number (`6`) form,
   * or `"latest"` (the latest the library supports). This influences
   * support for strict mode, the set of reserved words, and support for
   * new syntax features.
   */
  ecmaVersion: ecmaVersion;

  /**
   * `sourceType` indicates the mode the code should be parsed in.
   * Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
   * strict mode and parsing of `import` and `export` declarations.
   */
  sourceType?: "script" | "module" | "commonjs";

  /**
   * a callback that will be called when a semicolon is automatically inserted.
   * @param lastTokEnd the position of the comma as an offset
   * @param lastTokEndLoc location if {@link locations} is enabled
   */
  onInsertedSemicolon?: (lastTokEnd: number, lastTokEndLoc?: Position) => void;

  /**
   * similar to `onInsertedSemicolon`, but for trailing commas
   * @param lastTokEnd the position of the comma as an offset
   * @param lastTokEndLoc location if `locations` is enabled
   */
  onTrailingComma?: (lastTokEnd: number, lastTokEndLoc?: Position) => void;

  /**
   * By default, reserved words are only enforced if ecmaVersion >= 5.
   * Set `allowReserved` to a boolean value to explicitly turn this on
   * an off. When this option has the value "never", reserved words
   * and keywords can also not be used as property names.
   */
  allowReserved?: boolean | "never";

  /**
   * When enabled, a return at the top level is not considered an error.
   */
  allowReturnOutsideFunction?: boolean;

  /**
   * When enabled, import/export statements are not constrained to
   * appearing at the top of the program, and an import.meta expression
   * in a script isn't considered an error.
   */
  allowImportExportEverywhere?: boolean;

  /**
   * By default, `await` identifiers are allowed to appear at the top-level scope only if {@link ecmaVersion} >= 2022.
   * When enabled, await identifiers are allowed to appear at the top-level scope,
   * but they are still not allowed in non-async functions.
   */
  allowAwaitOutsideFunction?: boolean;

  /**
   * When enabled, super identifiers are not constrained to
   * appearing in methods and do not raise an error when they appear elsewhere.
   */
  allowSuperOutsideMethod?: boolean;

  /**
   * When enabled, hashbang directive in the beginning of file is
   * allowed and treated as a line comment. Enabled by default when
   * {@link ecmaVersion} >= 2023.
   */
  allowHashBang?: boolean;

  /**
   * By default, the parser will verify that private properties are
   * only used in places where they are valid and have been declared.
   * Set this to false to turn such checks off.
   */
  checkPrivateFields?: boolean;

  /**
   * When `locations` is on, `loc` properties holding objects with
   * `start` and `end` properties as {@link Position} objects will be attached to the
   * nodes.
   */
  locations?: boolean;

  /**
   * a callback that will cause Acorn to call that export function with object in the same
   * format as tokens returned from `tokenizer().getToken()`. Note
   * that you are not allowed to call the parser from the
   * callback—that will corrupt its internal state.
   */
  onToken: Option<((token: Token) => void) | Token[]>;

  /**
   * This takes a export function or an array.
   *
   * When a export function is passed, Acorn will call that export function with `(block, text, start,
   * end)` parameters whenever a comment is skipped. `block` is a
   * boolean indicating whether this is a block (`/* *\/`) comment,
   * `text` is the content of the comment, and `start` and `end` are
   * character offsets that denote the start and end of the comment.
   * When the {@link locations} option is on, two more parameters are
   * passed, the full locations of {@link Position} export type of the start and
   * end of the comments.
   *
   * When a array is passed, each found comment of {@link Comment} export type is pushed to the array.
   *
   * Note that you are not allowed to call the
   * parser from the callback—that will corrupt its internal state.
   */
  onComment: Option<
    | ((
        isBlock: boolean,
        text: string,
        start: number,
        end: number,
        startLoc?: Position,
        endLoc?: Position,
      ) => void)
    | Comment[]
  >;

  /**
   * Nodes have their start and end characters offsets recorded in
   * `start` and `end` properties (directly on the node, rather than
   * the `loc` object, which holds line/column data. To also add a
   * [semi-standardized][range] `range` property holding a `[start,
   * end]` array with the same numbers, set the `ranges` option to
   * `true`.
   */
  ranges?: boolean;

  /**
   * It is possible to parse multiple files into a single AST by
   * passing the tree produced by parsing the first file as
   * `program` option in subsequent parses. This will add the
   * toplevel forms of the parsed file to the `Program` (top) node
   * of an existing parse tree.
   */
  program?: Node;

  /**
   * When {@link locations} is on, you can pass this to record the source
   * file in every node's `loc` object.
   */
  sourceFile?: string;

  /**
   * This value, if given, is stored in every node, whether {@link locations} is on or off.
   */
  directSourceFile?: string;

  /**
   * When enabled, parenthesized expressions are represented by
   * (non-standard) ParenthesizedExpression nodes
   */
  preserveParens?: boolean;
}

export interface Options {
  /**
   * `ecmaVersion` indicates the ECMAScript version to parse. Can be a
   * number, either in year (`2022`) or plain version number (`6`) form,
   * or `"latest"` (the latest the library supports). This influences
   * support for strict mode, the set of reserved words, and support for
   * new syntax features.
   */
  ecmaVersion: number;

  /**
   * `sourceType` indicates the mode the code should be parsed in.
   * Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
   * strict mode and parsing of `import` and `export` declarations.
   */
  sourceType?: Option<"script" | "module" | "commonjs">;

  /**
   * a callback that will be called when a semicolon is automatically inserted.
   * @param lastTokEnd the position of the comma as an offset
   * @param lastTokEndLoc location if {@link locations} is enabled
   */
  onInsertedSemicolon?: Option<(lastTokEnd: number, lastTokEndLoc?: Position | null) => void>;

  /**
   * similar to `onInsertedSemicolon`, but for trailing commas
   * @param lastTokEnd the position of the comma as an offset
   * @param lastTokEndLoc location if `locations` is enabled
   */
  onTrailingComma?: Option<(lastTokEnd: number, lastTokEndLoc?: Position) => void>;

  /**
   * By default, reserved words are only enforced if ecmaVersion >= 5.
   * Set `allowReserved` to a boolean value to explicitly turn this on
   * an off. When this option has the value "never", reserved words
   * and keywords can also not be used as property names.
   */
  allowReserved?: Option<boolean | "never">;

  /**
   * When enabled, a return at the top level is not considered an error.
   */
  allowReturnOutsideFunction?: Option<boolean>;

  /**
   * When enabled, import/export statements are not constrained to
   * appearing at the top of the program, and an import.meta expression
   * in a script isn't considered an error.
   */
  allowImportExportEverywhere?: Option<boolean>;

  /**
   * By default, `await` identifiers are allowed to appear at the top-level scope only if {@link ecmaVersion} >= 2022.
   * When enabled, await identifiers are allowed to appear at the top-level scope,
   * but they are still not allowed in non-async functions.
   */
  allowAwaitOutsideFunction?: Option<boolean>;

  /**
   * When enabled, super identifiers are not constrained to
   * appearing in methods and do not raise an error when they appear elsewhere.
   */
  allowSuperOutsideMethod?: Option<boolean>;

  /**
   * When enabled, hashbang directive in the beginning of file is
   * allowed and treated as a line comment. Enabled by default when
   * {@link ecmaVersion} >= 2023.
   */
  allowHashBang?: Option<boolean>;

  /**
   * By default, the parser will verify that private properties are
   * only used in places where they are valid and have been declared.
   * Set this to false to turn such checks off.
   */
  checkPrivateFields?: Option<boolean>;

  /**
   * When `locations` is on, `loc` properties holding objects with
   * `start` and `end` properties as {@link Position} objects will be attached to the
   * nodes.
   */
  locations?: Option<boolean>;

  /**
   * a callback that will cause Acorn to call that export function with object in the same
   * format as tokens returned from `tokenizer().getToken()`. Note
   * that you are not allowed to call the parser from the
   * callback—that will corrupt its internal state.
   */
  onToken?: Option<(token: Token) => void>;

  /**
   * This takes a export function or an array.
   *
   * When a export function is passed, Acorn will call that export function with `(block, text, start,
   * end)` parameters whenever a comment is skipped. `block` is a
   * boolean indicating whether this is a block (`/* *\/`) comment,
   * `text` is the content of the comment, and `start` and `end` are
   * character offsets that denote the start and end of the comment.
   * When the {@link locations} option is on, two more parameters are
   * passed, the full locations of {@link Position} export type of the start and
   * end of the comments.
   *
   * When a array is passed, each found comment of {@link Comment} export type is pushed to the array.
   *
   * Note that you are not allowed to call the
   * parser from the callback—that will corrupt its internal state.
   */
  onComment?: Option<
    (
      parser: Parser,
      isBlock: boolean,
      text: string,
      start: number,
      end: number,
      startLoc?: Position | null,
      endLoc?: Position | null,
    ) => void
  >;

  /**
   * Nodes have their start and end characters offsets recorded in
   * `start` and `end` properties (directly on the node, rather than
   * the `loc` object, which holds line/column data. To also add a
   * [semi-standardized][range] `range` property holding a `[start,
   * end]` array with the same numbers, set the `ranges` option to
   * `true`.
   */
  ranges?: Option<boolean>;

  /**
   * It is possible to parse multiple files into a single AST by
   * passing the tree produced by parsing the first file as
   * `program` option in subsequent parses. This will add the
   * toplevel forms of the parsed file to the `Program` (top) node
   * of an existing parse tree.
   */
  program?: Option<Node>;

  /**
   * When {@link locations} is on, you can pass this to record the source
   * file in every node's `loc` object.
   */
  sourceFile?: Option<string>;

  /**
   * This value, if given, is stored in every node, whether {@link locations} is on or off.
   */
  directSourceFile?: Option<string>;

  /**
   * When enabled, parenthesized expressions are represented by
   * (non-standard) ParenthesizedExpression nodes
   */
  preserveParens?: Option<boolean>;
}

export class Parser {
  options: Options;
  input: string;

  protected constructor(options: Options, input: string, startPos?: number);
  parse(): Program;

  static parse(input: string, options: Options): Program;
  static parseExpressionAt(input: string, pos: number, options: Options): Expression;
  static tokenizer(
    input: string,
    options: Options,
  ): {
    getToken(): Token;
    [Symbol.iterator](): Iterator<Token>;
  };
  static extend(...plugins: ((BaseParser: typeof Parser) => typeof Parser)[]): typeof Parser;
}

export const defaultOptions: Options;

export function getLineInfo(input: string, offset: number): Position;

export class TokenType {
  label: string;
  keyword: string | undefined;
}

export const tokTypes: {
  num: TokenType;
  regexp: TokenType;
  string: TokenType;
  name: TokenType;
  privateId: TokenType;
  eof: TokenType;

  bracketL: TokenType;
  bracketR: TokenType;
  braceL: TokenType;
  braceR: TokenType;
  parenL: TokenType;
  parenR: TokenType;
  comma: TokenType;
  semi: TokenType;
  colon: TokenType;
  dot: TokenType;
  question: TokenType;
  questionDot: TokenType;
  arrow: TokenType;
  template: TokenType;
  invalidTemplate: TokenType;
  ellipsis: TokenType;
  backQuote: TokenType;
  dollarBraceL: TokenType;

  eq: TokenType;
  assign: TokenType;
  incDec: TokenType;
  prefix: TokenType;
  logicalOR: TokenType;
  logicalAND: TokenType;
  bitwiseOR: TokenType;
  bitwiseXOR: TokenType;
  bitwiseAND: TokenType;
  equality: TokenType;
  relational: TokenType;
  bitShift: TokenType;
  plusMin: TokenType;
  modulo: TokenType;
  star: TokenType;
  slash: TokenType;
  starstar: TokenType;
  coalesce: TokenType;

  _break: TokenType;
  _case: TokenType;
  _catch: TokenType;
  _continue: TokenType;
  _debugger: TokenType;
  _default: TokenType;
  _do: TokenType;
  _else: TokenType;
  _finally: TokenType;
  _for: TokenType;
  _function: TokenType;
  _if: TokenType;
  _return: TokenType;
  _switch: TokenType;
  _throw: TokenType;
  _try: TokenType;
  _var: TokenType;
  _const: TokenType;
  _while: TokenType;
  _with: TokenType;
  _new: TokenType;
  _this: TokenType;
  _super: TokenType;
  _class: TokenType;
  _extends: TokenType;
  _export: TokenType;
  _import: TokenType;
  _null: TokenType;
  _true: TokenType;
  _false: TokenType;
  _in: TokenType;
  _instanceof: TokenType;
  _typeof: TokenType;
  _void: TokenType;
  _delete: TokenType;
};

export interface Comment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
  loc?: SourceLocation;
  range?: [number, number];
}

export class Token {
  type: TokenType;
  start: number;
  end: number;
  loc?: SourceLocation;
  range?: [number, number];
}

export const version: string;
