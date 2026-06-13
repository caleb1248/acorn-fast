import type { Parser } from "./state.js";
import { SourceLocation, Position } from "./locutil.js";
import type { Node as _Node } from "./acorn.d.ts";

export class Node implements _Node {
  public type: string;
  public start: number;
  public end: number;
  public loc?: SourceLocation;
  public sourceFile?: string;
  public range?: [number, number];

  constructor(parser: Parser, pos: number, loc?: Position) {
    this.type = "";
    this.start = pos;
    this.end = 0;
    if (parser.options.locations && loc)
      this.loc = new SourceLocation(parser, loc, new Position(0, 0));
    if (parser.options.directSourceFile) this.sourceFile = parser.options.directSourceFile;
    if (parser.options.ranges) this.range = [pos, 0];
  }
}

export function startNode(parser: Parser) {
  return new Node(parser, parser.start, parser.startLoc);
}

export function startNodeAt(parser: Parser, pos: number, loc: Position) {
  return new Node(parser, pos, loc);
}

// Finish an AST node, adding `type` and `end` properties.

function finishNodeAt(parser: Parser, node: Node, type: string, pos: number, loc: Position) {
  node.type = type;
  node.end = pos;
  if (parser.options.locations) node.loc!.end = loc;
  if (parser.options.ranges) node.range![1] = pos;
  return node;
}

export function finishNode(parser: Parser, node: Node, type: string) {
  return finishNodeAt(parser, node, type, parser.lastTokEnd, parser.lastTokEndLoc);
}

// TODO: figure out how to port this to rust
export function copyNode(parser: Parser, node: Node) {
  let newNode = new Node(parser, node.start, parser.startLoc);
  for (let prop in node) newNode[prop] = node[prop];
  return newNode;
}
