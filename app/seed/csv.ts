/**
 * Just enough CSV to read one hand-maintained file.
 *
 * The cleaned Task Library is the only CSV this app will ever read, and it is
 * reviewed by hand before it is committed, so a dependency here would buy
 * dialect handling that no file needs. Quoted fields, doubled quotes inside
 * them, embedded newlines and CRLF are all handled, because a hand-edited
 * file can grow any of them; nothing else is.
 */
export interface CsvRow {
  /** The row's cells, keyed by the header's column names. */
  values: Record<string, string>;
  /**
   * The line the row starts on in the file, counting from 1.
   *
   * Carried rather than derived from the row's index, because blank lines are
   * dropped and a quoted field can span lines — so an error that says
   * "line 41" names a line a human can actually open.
   */
  line: number;
}

/** Parse a CSV into rows keyed by the header line's column names. */
export function parseCsv(text: string): CsvRow[] {
  const lines = parseRows(stripByteOrderMark(text));
  const header = lines.shift();
  if (!header) return [];

  return lines
    // A hand-edited file picks up trailing blank lines; a row of nothing is
    // not a Task and never was.
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""))
    .map(({ cells, line }) => ({
      line,
      values: Object.fromEntries(
        header.cells.map((name, index) => [name, cells[index] ?? ""]),
      ),
    }));
}

function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

interface SourceRow {
  cells: string[];
  line: number;
}

function parseRows(text: string): SourceRow[] {
  const rows: SourceRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStartedOn = 1;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (quoted) {
      if (character !== '"') {
        if (character === "\n") line++;
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push({ cells: row, line: rowStartedOn });
      row = [];
      field = "";
      line++;
      rowStartedOn = line;
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push({ cells: row, line: rowStartedOn });
  }
  return rows;
}
