import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./clan-theme.css";

export const metadata: Metadata = {
  title: "Turmoil · Resource Tracker",
  description:
    "The Forge Masters resource hub for the Turmoil clan. Plan together. Forge ahead.",
  applicationName: "Turmoil Resource Tracker",
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
