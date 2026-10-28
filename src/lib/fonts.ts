import localFont from "next/font/local";
import { Cormorant_Garamond } from "next/font/google";

export const whisperingSignature = localFont({
  src: "../../public/fonts/Stylish Handwriting Script .otf",
  display: "swap",
});

export const hughIsLife = localFont({
  src: "../../public/fonts/Hugh is Life Personal Use .ttf",
  display: "swap",
});

// The home page's display serif: tall, high-contrast, editorial (fashion magazine headlines)
export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
