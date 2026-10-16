import { Suspense } from "react";
import type { Metadata } from "next";
import { TrackerGuide } from "@/components/tracker-guide";

export const metadata: Metadata = {
  title: "Tracker Guide · Turmoil",
  description: "Where to find each number in Forge Master, in English, 繁體中文, 简体中文 and 한국어.",
};

export default function Page() {
  return (
    <Suspense>
      <TrackerGuide />
    </Suspense>
  );
}
