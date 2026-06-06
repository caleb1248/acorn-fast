import { Parser } from "./state.js";
import { Position, getLineInfo } from "./locutil.js";

// This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

export function raise(parser: Parser, pos: number, message: string) {
  let loc = getLineInfo(parser.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (parser.sourceFile) {
    message += " in " + parser.sourceFile;
  }
  let err = new SyntaxError(message);
  err.pos = pos;
  err.loc = loc;
  err.raisedAt = parser.pos;
  throw err;
}

export const raiseRecoverable = raise;

export function curPosition(parser: Parser) {
  if (parser.options.locations) {
    return new Position(parser.curLine, parser.pos - parser.lineStart);
  }
}
