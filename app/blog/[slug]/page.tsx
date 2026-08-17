import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBlogPostBySlug, getBlogPosts } from '../../../src/lib/blog-storage';

export async function generateStaticParams() {
  const posts = await getBlogPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) {
    return { title: 'Article Not Found' };
  }

  return {
    title: post.title,
    description: post.excerpt,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) notFound();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#fffaf0_12%,#f8fafc_100%)] text-slate-900">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/blog" className="text-sm font-black uppercase tracking-[0.18em] text-cyan-700 hover:text-cyan-900">Back to blog</Link>
        <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-amber-600">{post.category}</p>
        <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl">{post.title}</h1>
        <p className="mt-6 text-lg leading-8 text-slate-600">{post.excerpt}</p>
        <div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{post.readTime} · {new Date(post.publishedAt).toLocaleDateString()}</div>
        <div className="mt-10 space-y-6 text-base leading-8 text-slate-700">
          {post.content.map((paragraph, index) => (
            <p key={`${post.id}-${index}`}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  );
}