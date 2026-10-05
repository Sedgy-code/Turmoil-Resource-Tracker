import { Suspense } from "react";
import Tracker from "@/components/tracker";
export default function Page() {
  return (
    <Suspense>
      <Tracker view="weeks" />
    </Suspense>
  );
}
