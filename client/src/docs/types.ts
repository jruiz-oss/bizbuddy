import type { ReactNode } from "react";

export type Article = {
  slug: string;
  title: string;
  description: string;
  group: string;
  body: () => ReactNode;
};
