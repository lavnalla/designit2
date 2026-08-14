import type { Metadata } from "next";
import { Geist, Geist_Mono, Quicksand } from "next/font/google";
import "./globals.css";

const quicksand = Quicksand({
  subsets: ["latin"],
  variable: "--font-quicksand",
  weight: ["300", "400", "500", "600", "700"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { Analytics } from "@vercel/analytics/next";
// app/layout.tsx
import React from "react";
import Script from "next/script";
import CookieConsent from "../src/components/CookieConsent";

const siteUrl = "https://idesignits.com";
const siteName = "DesignIt";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "DesignIt - Free Online Design Tool for Clothes, Jewelry & More | Canva Alternative",
    template: `%s | ${siteName}`,
  },
  description:
    "Create stunning designs for clothes, jewelry, fashion, and more - 100% free! Easy-to-use online design studio with image tracing, vector editing, and dress form tools. The best free Canva alternative for creative designers.",
  keywords: [
    // Primary Keywords - Canva Alternative
    "Canva alternative",
    "Canva alternative free",
    "free design tool like Canva",
    "better than Canva",
    "Canva competitor",
    "online design tool free",
    "free graphic design software",
    
    // User-Friendly Design Tools
    "easy design tool",
    "design app for beginners",
    "free online design maker",
    "no experience design tool",
    "simple design software",
    "drag and drop design",
    "design anything online",
    
    // Fashion & Jewelry Focus
    "design clothes online free",
    "jewelry design online",
    "fashion design free",
    "clothing designer app",
    "design your own clothes",
    "jewelry maker online",
    "fashion design for beginners",
    "create clothing designs",
    "DIY fashion design",
    "custom jewelry design",
    
    // General Creative Design
    "create designs online",
    "design tool online free",
    "web design tool",
    "creative design software",
    "digital design tool",
    "design studio online",
    "free designer app",
    
    // Image Editing
    "online image editor",
    "edit images free",
    "image manipulation tool",
    "trace image online",
    "vectorize image free",
    "photo editor online",
    "image to vector converter",
    
    // Features
    "dress form online",
    "mannequin tool",
    "draping tool online",
    "pattern design tool",
    "vector editor free",
    "drawing tool online",
    
    // Target Users
    "design tool for hobbyists",
    "DIY design software",
    "creative tools free",
    "design for everyone",
    "beginner design app",
    
    // Competitor Alternatives
    "Adobe alternative free",
    "Photoshop alternative",
    "Illustrator alternative free",
    "Figma alternative",
    "free design software no download",
  ],
  openGraph: {
    title: "DesignIt - Free Design Tool for Clothes, Jewelry & More | Canva Alternative",
    description:
      "Design anything you imagine - clothes, jewelry, graphics, and more! 100% free, easy-to-use online design studio. No experience needed. The best free alternative to Canva.",
    url: siteUrl,
    siteName,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "DesignIt - Free Online Design Tool for Clothes, Jewelry & Creative Projects",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DesignIt - Free Design Tool | Better Alternative to Canva",
    description:
      "Create beautiful designs for clothes, jewelry, and more - 100% free! Easy drag-and-drop design studio with professional tools. No downloads, no experience needed.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  category: "design",
};

export const viewport = {
  themeColor: "#800000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Structured data JSON-LD for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "DesignIt - Free Design Studio",
    url: siteUrl,
    applicationCategory: "DesignApplication",
    operatingSystem: "Any (Web Browser)",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description:
      "Free online design tool for everyone! Create beautiful designs for clothes, jewelry, fashion, graphics, and more. Easy-to-use design studio with image tracing, vector editing, and professional tools. No downloads, no experience needed. The perfect free alternative to Canva.",
    screenshot: `${siteUrl}/og-image.png`,
    featureList: [
      "100% Free - No subscriptions or hidden fees",
      "Easy to use - No design experience needed",
      "Design clothes, jewelry, and more",
      "Image tracing and vectorization",
      "Customizable dress form with measurements",
      "Garment draping tools for fashion design",
      "Vector shape manipulation",
      "Drawing and painting tools",
      "No installation - Works in browser",
      "Better alternative to Canva",
    ],
    publisher: {
      "@type": "Organization",
      name: "Learncapes Inc.",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/logo.png`,
      },
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      ratingCount: "284",
      bestRating: "5",
    },
    audience: {
      "@type": "Audience",
      audienceType: "Everyone - Beginners to Professionals",
    },
  };

  return (
    <html lang="en">
      <head>
        {/* The Next.js metadata API injects the metadata above. Add structured data for rich search results. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${quicksand.variable} antialiased`}>
        {/* Google AdSense */}
        <Script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7392693183875834" crossOrigin="anonymous" strategy="afterInteractive" />
        
        {/* Google Ads (AdWords) Conversion Tracking */}
        {process.env.NEXT_PUBLIC_GOOGLE_ADS_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GOOGLE_ADS_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-ads" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GOOGLE_ADS_ID}');
              `}
            </Script>
          </>
        )}

        {/* Add these two script lines */}
        <Script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.11.0/dist/tf.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js" strategy="beforeInteractive" />
        
        {children}
        <CookieConsent />
        <Analytics />
      </body>
    </html>
  );
}