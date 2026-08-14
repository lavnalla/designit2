"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function CommunityBackButton() {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="flex items-center gap-2 text-white hover:text-yellow-100 transition-colors"
    >
      <ArrowLeft size={20} className="drop-shadow-sm" />
      <span className="font-semibold text-sm drop-shadow-sm">Back</span>
    </button>
  );
}