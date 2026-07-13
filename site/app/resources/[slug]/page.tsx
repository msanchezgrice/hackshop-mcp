import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { editorialPosts, getEditorialPost } from "@/lib/editorial";
import styles from "../editorial.module.css";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return editorialPosts.map((post) => ({ slug: post.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getEditorialPost((await params).slug); if (!post) return {};
  return { title: post.title, description: post.description, keywords: post.tags, alternates: { canonical: `/resources/${post.slug}` }, openGraph: { title: post.title, description: post.description, type: "article", url: `/resources/${post.slug}`, publishedTime: post.publishedAt, modifiedTime: post.updatedAt } };
}
export default async function ResourceArticle({ params }: Props) {
  const post = getEditorialPost((await params).slug); if (!post) notFound();
  const related = post.relatedSlugs.map(getEditorialPost).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const canonical = `https://www.hackshop.dev/resources/${post.slug}`;
  const jsonLd = { "@context":"https://schema.org", "@type":"Article", headline:post.title, description:post.description, datePublished:post.publishedAt, dateModified:post.updatedAt, wordCount:post.wordCount, mainEntityOfPage:canonical, author:{"@type":"Organization",name:"Hackshop"}, publisher:{"@type":"Organization",name:"Hackshop"}, keywords:post.tags.join(", ") };
  return <main className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(jsonLd).replace(/</g,"\u003c")}}/><div className={styles.shell}>
    <nav className={styles.nav}><Link className={styles.brand} href="/">Hackshop</Link><div className={styles.navLinks}><Link href="/resources">All resources</Link><Link className={styles.button} href="/?utm_source=resources&utm_medium=content&utm_campaign=wave2">Ask the hardware scout</Link></div></nav>
    <header className={styles.articleHero}><p className={styles.eyebrow}>{post.pillar ? "2,000+ word workbook" : "Field guide"}</p><h1>{post.title}</h1><p>{post.description}</p><div className={styles.articleMeta}><span>{post.readingMinutes} minute read</span><span>{post.wordCount.toLocaleString()} words</span><span>Reviewed July 13, 2026</span></div><div className={styles.tags}>{post.tags.map(tag=><span className={styles.pill} key={tag}>{tag}</span>)}</div></header>
    <div className={styles.articleLayout}><article className={styles.article} dangerouslySetInnerHTML={{__html:post.bodyHtml}}/><aside className={styles.sidebar}><h2>Related guides</h2>{related.map(item=><Link href={`/resources/${item.slug}`} key={item.slug}>{item.title}</Link>)}<p className={styles.sourceNote}>Sources were checked on July 13, 2026. Follow each publisher for the newest revision.</p></aside></div>
    <footer className={styles.footer}>Educational information, not individualized legal, medical, financial, or safety advice.</footer>
  </div></main>;
}
