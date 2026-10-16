"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MESSAGES } from "./messages";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "ko", label: "한국어" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
type TranslatedLanguage = Exclude<Language, "en">;
export type Translate = (english: string, values?: Record<string, string | number>) => string;

const STORAGE_KEY = "turmoil-language";
const COOKIE_NAME = "turmoil_language";
const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((language) => language.code === value);

/** Matches a browser language such as zh-TW, zh-CN or ko-KR to a tracker language. */
export function languageFromBrowser(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const tag = preference.toLowerCase();
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("zh")) {
      if (tag.includes("hant") || /-(tw|hk|mo)\b/.test(tag)) return "zh-Hant";
      return "zh-Hans";
    }
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match);
}

/** Looks up the English text in the dictionary; untranslated text stays English. */
export function translate(language: Language, english: string, values?: Record<string, string | number>): string {
  const entry = language === "en" ? undefined : MESSAGES[english]?.[language as TranslatedLanguage];
  return fill(entry ?? english, values);
}

function savedLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be blocked in private browsing or in-app browsers.
  }
  const cookie = document.cookie.split("; ").find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const value = cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null;
  return isLanguage(value) ? value : null;
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: (english, values) => fill(english, values),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    setLanguageState(savedLanguage() ?? languageFromBrowser(navigator.languages ?? [navigator.language]));
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
    // A cookie as well, because some in-app browsers clear local storage.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (english, values) => translate(language, english, values),
  }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Shorthand for components that only need the translate function. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}

/** Number format for the chosen language (digit grouping stays familiar everywhere). */
export function localeFor(language: Language): string {
  return language === "en" ? "en-US" : language === "zh-Hant" ? "zh-TW" : language === "zh-Hans" ? "zh-CN" : "ko-KR";
}
