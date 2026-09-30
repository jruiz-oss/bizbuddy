import type { Article } from "./types";
import { startArticles } from "./content-start";
import { bulkArticles } from "./content-bulk";
import { qualityArticles } from "./content-quality";
import { helpArticles } from "./content-help";

export const articles: Article[] = [...startArticles, ...bulkArticles, ...qualityArticles, ...helpArticles];

export const groupOrder = [
  "Get started",
  "Manage locations",
  "Bulk updates",
  "Quality and monitoring",
  "Troubleshooting",
  "Reference",
];

export const bySlug = (slug: string) => articles.find((a) => a.slug === slug);

export const grouped = groupOrder.map((g) => ({ group: g, items: articles.filter((a) => a.group === g) }));
