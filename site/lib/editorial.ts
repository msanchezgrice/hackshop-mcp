import rawPosts from "../../content/editorial/wave2-content.json";

export type EditorialPost = {
  number: number;
  title: string;
  slug: string;
  job: string;
  pillar: boolean;
  tags: string[];
  tweet: string;
  video: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  relatedSlugs: string[];
  sources: Array<{ label: string; url: string }>;
  bodyHtml: string;
  wordCount: number;
  readingMinutes: number;
};

export const editorialPosts = rawPosts as EditorialPost[];
export const getEditorialPost = (slug: string) => editorialPosts.find((post) => post.slug === slug);
