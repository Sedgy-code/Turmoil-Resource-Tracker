import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./clan-theme.css";
import "./planning.css";
import "./member-help.css";
import "./app-shell.css";
import "./glow-theme.css";
import "./colour-refine.css";
import "./easy-touch.css";
import "./stack-tables.css";
import "./calm.css";
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_SHORT_NAME,
  APP_THEME_COLOR,
} from "@/lib/app-shell";
import { CALM_SCRIPT } from "@/lib/calm";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // Opened from an iPhone's home screen: full screen with a dark clock bar.
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: APP_THEME_COLOR,
  // Lets the page use the whole phone screen; app-shell.css keeps content clear of the clock and notch.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The calmer look, if this phone chose it, before anything is drawn. */}
        <script dangerouslySetInnerHTML={{ __html: CALM_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
