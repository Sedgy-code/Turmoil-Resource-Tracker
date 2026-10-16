import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./clan-theme.css";
import "./planning.css";
import "./member-help.css";

export const metadata: Metadata = {
  title: "Turmoil Clan Hub",
  description:
    "The Turmoil clan hub for Forge Masters. The Turmoil Way.",
  applicationName: "Turmoil Clan Hub",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
