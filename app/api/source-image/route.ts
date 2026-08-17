import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get('url');

  if (!source) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(source);
  } catch {
    return NextResponse.json({ error: 'Invalid source url' }, { status: 400 });
  }

  if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    return NextResponse.json({ error: 'Unsupported url protocol' }, { status: 400 });
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'DesignItStudio/1.0',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream image request failed with ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Source url did not return an image' }, { status: 415 });
    }

    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch source image';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
