import type { MetadataRoute } from "next";
import {
  APP_DESCRIPTION,
  APP_ICONS,
  APP_NAME,
  APP_SHORT_NAME,
  APP_THEME_COLOR,
} from "@/lib/app-shell";

// Lets members add the hub to their phone's home screen and open it like an
// app: the Turmoil crest as its icon, full screen, no browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: APP_THEME_COLOR,
    theme_color: APP_THEME_COLOR,
    icons: APP_ICONS.map(({ src, size, purpose }) => ({
      src,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose,
    })),
  };
}
