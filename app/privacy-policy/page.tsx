import type { Metadata } from "next";
import PrivacyPolicyPageClient from "./PrivacyPolicyPageClient";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read the DesignIt privacy policy covering cookies, analytics, AdSense and how user information is handled.",
  alternates: {
    canonical: "/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyPageClient />;
}
