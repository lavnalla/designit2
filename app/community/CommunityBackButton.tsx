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
      className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-black shadow-md ring-1 ring-amber-200 transition-colors hover:bg-white hover:text-black"
    >
      <ArrowLeft size={20} className="text-black" />
      <span className="text-sm font-black uppercase tracking-wide text-black">Back</span>
    </button>
  );
}