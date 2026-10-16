"use client";

import { Languages } from "lucide-react";
import { LANGUAGES, useLanguage, type Language } from "@/lib/i18n";

/** Always labelled in every language, so anyone can find it. */
export function LanguagePicker({ className = "" }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  return (
    <label className={`language-picker ${className}`}>
      <Languages size={16} aria-hidden="true" />
      <span className="visually-hidden">Language · 語言 · 语言 · 언어</span>
      <select
        aria-label="Language · 語言 · 语言 · 언어"
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code} lang={code}>{label}</option>
        ))}
      </select>
    </label>
  );
}
