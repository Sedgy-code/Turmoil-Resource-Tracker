"use client";
import { LanguageProvider, useT } from "@/lib/i18n";

function ErrorMessage({ reset }: { reset: () => void }) {
  const t = useT();
  return (
    <main className="fatal-error">
      <h1>{t("Something went wrong.")}</h1>
      <p>{t("Please try again. Your saved resources are safe.")}</p>
      <button className="button primary" onClick={reset}>
        {t("Try again")}
      </button>
    </main>
  );
}

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <LanguageProvider><ErrorMessage reset={reset} /></LanguageProvider>;
}
