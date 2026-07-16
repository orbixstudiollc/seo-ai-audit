import Papa from "papaparse";
import { MAX_ARTICLE_LIST_ROWS } from "./constants";

export interface ArticleListRow {
  url: string;
  /** null when the CSV's title cell was empty — the importer falls back to the page's own title. */
  title: string | null;
  /** 1-indexed as a spreadsheet user would see it (row 1 is the header). */
  rowNumber: number;
}

export interface ParseArticleListResult {
  rows: ArticleListRow[];
  /** Non-fatal: rows skipped (e.g. missing url) or minor parser complaints. Parsing still succeeded. */
  warnings: string[];
  /** Set when nothing in the file was usable — caller should stop before importing anything. */
  fatalError: string | null;
}

/**
 * Parses a "list of articles" CSV: a required `url` column (one article per
 * row) and an optional `title` column. Uses papaparse rather than a hand-
 * rolled split(",") specifically because real-world exports from Excel/Sheets
 * quote fields containing commas (e.g. a title like "SEO Tips, Tricks, and
 * Tools") — a naive split silently mis-parses exactly that case.
 */
export function parseArticleListCsv(csvText: string): ParseArticleListResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  const warnings = parsed.errors.map(
    (err) => `Row ${(err.row ?? 0) + 2}: ${err.message}`, // +2: header row, then 0-indexed data rows
  );

  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("url")) {
    return {
      rows: [],
      warnings,
      fatalError: 'CSV must have a "url" column header (one article URL per row).',
    };
  }

  const rows: ArticleListRow[] = [];
  parsed.data.forEach((record, index) => {
    const rowNumber = index + 2;
    const url = record.url?.trim();
    if (!url) {
      warnings.push(`Row ${rowNumber}: missing url, skipped.`);
      return;
    }
    const title = record.title?.trim();
    rows.push({ url, title: title ? title : null, rowNumber });
  });

  if (rows.length === 0) {
    return { rows: [], warnings, fatalError: "No rows with a url were found in that CSV." };
  }

  if (rows.length > MAX_ARTICLE_LIST_ROWS) {
    return {
      rows: [],
      warnings,
      fatalError:
        `This CSV has ${rows.length} article rows; the limit is ${MAX_ARTICLE_LIST_ROWS} per upload — ` +
        "split it into smaller batches.",
    };
  }

  return { rows, warnings, fatalError: null };
}
