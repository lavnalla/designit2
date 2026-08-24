import type { Metadata } from "next";
import TermsOfServicePageClient from "./TermsOfServicePageClient";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Review the DesignIt terms of service for using the free online design studio and related services.",
  alternates: {
    canonical: "/terms-of-service",
  },
};

export default function TermsOfServicePage() {
  return <TermsOfServicePageClient />;
}
