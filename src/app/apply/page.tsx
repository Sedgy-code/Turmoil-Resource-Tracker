import type { Metadata } from "next";
import { ApplyPage } from "@/components/apply";

export const metadata: Metadata = {
  title: "Join Turmoil · Turmoil Clan Hub",
  description: "Apply to join Turmoil, a Forge Master clan.",
};

export default function Page() {
  return <ApplyPage />;
}
