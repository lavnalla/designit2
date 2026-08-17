import { getBlogPosts, saveBlogPost } from '../../../src/lib/blog-storage';

function isAdmin(request: Request) {
  return request.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeDrafts = searchParams.get('admin') === 'true' && isAdmin(request);
  const posts = await getBlogPosts(includeDrafts);
  return Response.json(posts);
}

export async function POST(request: Request) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { slug, title, excerpt, category, readTime, published, content } = body;

  if (!slug || !title || !excerpt || !category || !readTime || !Array.isArray(content) || content.length === 0) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const post = await saveBlogPost({
    slug,
    title,
    excerpt,
    category,
    readTime,
    published: Boolean(published),
    content,
  });

  return Response.json(post);
}