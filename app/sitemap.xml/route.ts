// app/sitemap.xml/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = "https://idesignits.com";

  const pages = [
    { url: `${baseUrl}/`, priority: "1.0", changefreq: "daily" },
    { url: `${baseUrl}/about`, priority: "0.8", changefreq: "monthly" },
    { url: `${baseUrl}/contact`, priority: "0.8", changefreq: "monthly" },
    { url: `${baseUrl}/community`, priority: "0.7", changefreq: "weekly" },
    { url: `${baseUrl}/privacy-policy`, priority: "0.4", changefreq: "yearly" },
    { url: `${baseUrl}/terms-of-service`, priority: "0.4", changefreq: "yearly" },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${pages
      .map(
        (page) => `
      <url>
        <loc>${page.url}</loc>
        <changefreq>${page.changefreq}</changefreq>
        <priority>${page.priority}</priority>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
      </url>
    `
      )
      .join("")}
  </urlset>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}