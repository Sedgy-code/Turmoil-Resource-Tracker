"use client";
import Link from "next/link";
import { LanguageProvider, useT } from "@/lib/i18n";

function NotFoundMessage() {
  const t = useT();
  return (
    <main className="fatal-error">
      <h1>{t("Page not found.")}</h1>
      <p>{t("This page doesn’t exist. Check the link, or go back Home.")}</p>
      <Link className="button primary" href="/">
        {t("Home")}
      </Link>
    </main>
  );
}

export default function NotFound() {
  return <LanguageProvider><NotFoundMessage /></LanguageProvider>;
}
