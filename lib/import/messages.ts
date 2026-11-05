import type { ImportFileError } from "./file"

// What the person importing reads when a file is refused, in English and
// Swahili.

export type Bilingual = { en: string; sw: string }

const count = (n: number) => n.toLocaleString("en-US")

export function importFileMessage(error: ImportFileError): Bilingual {
  switch (error.kind) {
    case "too-large": {
      const kb = Math.round(error.maxBytes / 1024)
      return {
        en: `This file is larger than ${kb} KB. Split it into smaller files and upload each one.`,
        sw: `Faili hili ni kubwa kuliko KB ${kb}. Ligawe katika mafaili madogo, kisha pakia moja moja.`,
      }
    }
    case "too-many-rows":
      return {
        en: `This file has ${count(error.rows)} rows. Upload at most ${count(error.maxRows)} rows at a time.`,
        sw: `Faili hili lina safu ${count(error.rows)}. Pakia safu zisizozidi ${count(error.maxRows)} kwa wakati mmoja.`,
      }
    case "not-utf8":
      return {
        en: "This file isn't saved as UTF-8 text. In Google Sheets, choose File, then Download, then Comma-separated values (.csv).",
        sw: "Faili hili halijahifadhiwa kama maandishi ya UTF-8. Katika Google Sheets, chagua File, kisha Download, kisha Comma-separated values (.csv).",
      }
    case "empty":
      return {
        en: "This file has no rows to import. Keep the template's first row as the header and add a row for each person.",
        sw: "Faili hili halina safu za kuingiza. Acha safu ya kwanza ya kiolezo kama kichwa, na uongeze safu kwa kila mtu.",
      }
    case "missing-columns": {
      const names = error.columns.join(" or ")
      const majina = error.columns.join(" au ")
      return {
        en: `This file has no ${names} column. Use the template's first row as the header.`,
        sw: `Faili hili halina safu wima ya ${majina}. Tumia safu ya kwanza ya kiolezo kama kichwa.`,
      }
    }
    case "unreadable":
      return {
        en: "This file can't be read as CSV: a quotation mark is never closed. Download it from Google Sheets again as CSV.",
        sw: "Faili hili haliwezi kusomwa kama CSV: alama ya nukuu haijafungwa. Lipakue tena kutoka Google Sheets kama CSV.",
      }
  }
}
