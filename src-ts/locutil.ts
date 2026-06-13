import type { Parser } from "./state";
import { nextLineBreak } from "./whitespace.js";
import type { Position as _Position } from "./acorn";

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

export class Position implements _Position {
  public line: number;
  public column: number;
  constructor(line: number, col: number) {
    this.line = line;
    this.column = col;
  }
}

export class SourceLocation {
  public start: Position;
  public end: Position;
  public source?: string | null;

  constructor(p: Parser, start: Position, end: Position) {
    this.start = start;
    this.end = end;
    if (p.sourceFile !== null) this.source = p.sourceFile;
  }
}

// The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

export function getLineInfo(input: string, offset: number) {
  for (let line = 1, cur = 0; ; ) {
    let nextBreak = nextLineBreak(input, cur, offset);
    if (nextBreak < 0) return new Position(line, offset - cur);
    ++line;
    cur = nextBreak;
  }
}
