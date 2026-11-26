import type { MentoResult } from "./searchProviders";

export type CitationStyle = "APA" | "IEEE" | "MLA";

export function formatCitation(paper: MentoResult, style: CitationStyle = "APA") {
  const authors = paper.authors.map((name) => name.trim()).filter(Boolean).join(", ");
  const year = paper.year ? String(paper.year) : "n.d.";
  const title = paper.title.trim().replace(/[.\s]+$/, "");
  const venue = paper.venue?.trim().replace(/[.\s]+$/, "");
  const link = paper.doi ? `https://doi.org/${paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : paper.url?.trim();
  const authorText = authors || "Unknown author";
  let text: string;
  if (style === "IEEE") {
    text = `${authorText}, “${title},”${venue ? ` ${venue},` : ""} ${year}.${link ? ` ${link}.` : ""}`;
  } else if (style === "MLA") {
    text = `${authorText}. “${title}.”${venue ? ` ${venue},` : ""} ${year}.${link ? ` ${link}.` : ""}`;
  } else {
    text = `${authorText} (${year}). ${title}.${venue ? ` ${venue}.` : ""}${link ? ` ${link}.` : ""}`;
  }
  return { authors: authorText, year, text: text.replace(/\s+/g, " ").trim() };
}
