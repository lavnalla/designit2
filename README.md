This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Browser Extension

The repo includes an unpacked browser extension at `public/designit-extension`.

To install it in Chrome or Edge:

```text
1. Open the browser extensions page.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select the public/designit-extension folder.
```

After installation, right-click any image and choose `Open in DesignIt`. The extension opens Studio with the image preloaded into Source through `/studio?source=...`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Variables

Create a `.env.local` file in the project root with your Google advertising IDs:

```bash
NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT=ca-pub-your-client-id
NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT=your-homepage-ad-slot
NEXT_PUBLIC_GOOGLE_ADS_ID=AW-your-google-ads-id
```

Notes:

- `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT` is your AdSense publisher ID.
- `NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT` is the ad unit slot used on the homepage.
- `NEXT_PUBLIC_GOOGLE_ADS_ID` is optional and only needed if you want Google Ads conversion tracking.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
