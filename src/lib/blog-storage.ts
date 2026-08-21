import { promises as fs } from 'fs';
import path from 'path';

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  published: boolean;
  publishedAt: string;
  content: string[];
}

const blogFilePath = path.join(process.cwd(), 'data', 'blog-posts.json');

async function ensureBlogFile() {
  await fs.mkdir(path.dirname(blogFilePath), { recursive: true });
  try {
    await fs.access(blogFilePath);
  } catch {
    await fs.writeFile(blogFilePath, '[]', 'utf8');
  }
}

async function readBlogFile(): Promise<BlogPost[]> {
  await ensureBlogFile();
  const raw = await fs.readFile(blogFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeBlogFile(posts: BlogPost[]) {
  await ensureBlogFile();
  await fs.writeFile(blogFilePath, JSON.stringify(posts, null, 2), 'utf8');
}

export async function getBlogPosts(includeDrafts = false): Promise<BlogPost[]> {
  const posts = await readBlogFile();
  return posts
    .filter(post => includeDrafts || post.published)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export async function getBlogPostBySlug(slug: string, includeDrafts = false): Promise<BlogPost | null> {
  const posts = await getBlogPosts(includeDrafts);
  return posts.find(post => post.slug === slug) ?? null;
}

export async function saveBlogPost(input: Omit<BlogPost, 'id' | 'publishedAt'> & { id?: string; publishedAt?: string }): Promise<BlogPost> {
  const posts = await readBlogFile();
  const now = new Date().toISOString();
  const nextPost: BlogPost = {
    id: input.id ?? `post-${Date.now()}`,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    category: input.category,
    readTime: input.readTime,
    published: input.published,
    publishedAt: input.publishedAt ?? now,
    content: input.content,
  };

  const existingIndex = posts.findIndex(post => post.id === nextPost.id || post.slug === nextPost.slug);
  if (existingIndex >= 0) {
    posts[existingIndex] = { ...posts[existingIndex], ...nextPost };
  } else {
    posts.push(nextPost);
  }

  await writeBlogFile(posts);
  return nextPost;
}