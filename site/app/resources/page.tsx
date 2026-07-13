import type { Metadata } from "next";
import Link from "next/link";
import { editorialPosts } from "@/lib/editorial";
import styles from "./editorial.module.css";

export const metadata: Metadata = {
  title: "Resources | Hackshop",
  description: "Field guides for choosing, evaluating, flashing, recovering, and repurposing hackable hardware.",
  alternates: { canonical: "/resources" },
  openGraph: { title: "Resources | Hackshop", description: "Field guides for choosing, evaluating, flashing, recovering, and repurposing hackable hardware.", url: "/resources", images: ["/opengraph-image"] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

export default function ResourcesPage() {
  return <main className={styles.page}>
    <div className={styles.shell}>
      <nav className={styles.nav}><Link className={styles.brand} href="/">Hackshop</Link><div className={styles.navLinks}><Link href="/resources">Resources</Link><Link className={styles.button} href="/?utm_source=resources&utm_medium=content&utm_campaign=wave2">Ask the hardware scout</Link></div></nav>
      <header className={styles.hero}><p className={styles.eyebrow}>Practical, source-linked field guides</p><h1>Make the next decision with evidence.</h1><p>Field guides for choosing, evaluating, flashing, recovering, and repurposing hackable hardware. Every guide includes a repeatable workflow, explicit limits, primary sources, internal links, and a real next step.</p></header>
      <section className={styles.grid} aria-label="All resources">{editorialPosts.map((post) => <Link className={`${styles.card} ${post.pillar ? styles.pillar : ""}`} href={`/resources/${post.slug}`} key={post.slug}><div className={styles.meta}><span className={styles.pill}>{post.pillar ? "Deep guide" : `${post.readingMinutes} minute guide`}</span>{post.tags.slice(0,2).map((tag)=><span className={styles.pill} key={tag}>{tag}</span>)}</div><h2>{post.title}</h2><p>{post.description}</p></Link>)}</section>
      <footer className={styles.footer}>Updated July 13, 2026 · Sources are linked at the claim they support · For home-robot test methods, visit <a href="https://housebrokenlabs.com/resources">Housebroken Labs</a>.</footer>
    </div>
  </main>;
}
