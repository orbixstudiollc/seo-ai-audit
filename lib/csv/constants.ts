/**
 * Zero-dependency constants shared by the server-side CSV parser
 * (lib/csv/parseArticleList.ts, which imports papaparse) and the client-side
 * upload form (which must NOT pull papaparse into the browser bundle just to
 * render a help string). A dedicated file, not a re-export from the parser
 * module, is what actually keeps papaparse out of the client bundle — Next's
 * bundler can't tree-shake around a module with real top-level imports the
 * way it can trivially exclude an unused export from a file that has none.
 */
export const MAX_ARTICLE_LIST_ROWS = 25;
