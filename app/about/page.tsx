import type { Metadata } from "next";
import AboutPageClient from "./AboutPageClient";

export const metadata: Metadata = {
  title: "About DesignIt",
  description:
    "Learn about DesignIt, the free browser-based design studio for apparel, jewelry and creative mockups.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return <AboutPageClient />;
}
