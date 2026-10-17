// How the hub looks when a member adds it to their phone's home screen:
// the name under the icon, and the colour of the bar behind the phone's clock.
export const APP_NAME = "Turmoil Clan Hub";
export const APP_SHORT_NAME = "Turmoil";
export const APP_DESCRIPTION =
  "The Turmoil clan hub for Forge Masters. The Turmoil Way.";
// Matches --bg in globals.css so the app opens without a flash of another colour.
export const APP_THEME_COLOR = "#080b09";

// Home screen icons made from public/turmoil-crest.png.
// "maskable" ones keep the crest inside the circle Android crops icons to.
export const APP_ICONS = [
  { src: "/app-icons/icon-192.png", size: 192, purpose: "any" },
  { src: "/app-icons/icon-512.png", size: 512, purpose: "any" },
  { src: "/app-icons/icon-maskable-192.png", size: 192, purpose: "maskable" },
  { src: "/app-icons/icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;
