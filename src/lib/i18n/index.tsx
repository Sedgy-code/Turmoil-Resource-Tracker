"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** Each language is labelled in itself so people can find their own. */
export const LANGUAGES = [
  { code: "en", label: "English", locale: "en-US" },
  { code: "zh-Hant", label: "繁體中文", locale: "zh-TW" },
  { code: "zh-Hans", label: "简体中文", locale: "zh-CN" },
  { code: "ko", label: "한국어", locale: "ko-KR" },
  { code: "ja", label: "日本語", locale: "ja-JP" },
  { code: "vi", label: "Tiếng Việt", locale: "vi-VN" },
  { code: "th", label: "ไทย", locale: "th-TH" },
  { code: "id", label: "Bahasa Indonesia", locale: "id-ID" },
  { code: "ms", label: "Bahasa Melayu", locale: "ms-MY" },
  { code: "fil", label: "Filipino", locale: "fil-PH" },
  { code: "es", label: "Español", locale: "es" },
  { code: "pt", label: "Português", locale: "pt-BR" },
  { code: "fr", label: "Français", locale: "fr-FR" },
  { code: "de", label: "Deutsch", locale: "de-DE" },
  { code: "ru", label: "Русский", locale: "ru-RU" },
  { code: "tr", label: "Türkçe", locale: "tr-TR" },
  { code: "ar", label: "العربية", locale: "ar" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
type Dictionary = Record<string, string>;
/** Languages written right to left; the whole page is mirrored for these. */
const RIGHT_TO_LEFT: readonly Language[] = ["ar"];

// Only the chosen language's file is downloaded.
const LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: Dictionary }>> = {
  "zh-Hant": () => import("./locales/zh-Hant.json"),
  "zh-Hans": () => import("./locales/zh-Hans.json"),
  ko: () => import("./locales/ko.json"),
  ja: () => import("./locales/ja.json"),
  vi: () => import("./locales/vi.json"),
  th: () => import("./locales/th.json"),
  id: () => import("./locales/id.json"),
  ms: () => import("./locales/ms.json"),
  fil: () => import("./locales/fil.json"),
  es: () => import("./locales/es.json"),
  pt: () => import("./locales/pt.json"),
  fr: () => import("./locales/fr.json"),
  de: () => import("./locales/de.json"),
  ru: () => import("./locales/ru.json"),
  tr: () => import("./locales/tr.json"),
  ar: () => import("./locales/ar.json"),
};
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
    const base = tag.startsWith("tl") ? "fil" : tag.startsWith("in") ? "id" : tag.split("-")[0];
    if (LANGUAGES.some(({ code }) => code === base)) return base as Language;
  }
  return "en";
}

function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match);
}

/** Looks up the English text in the dictionary; untranslated text stays English. */
export function translate(dictionary: Dictionary | null, english: string, values?: Record<string, string | number>): string {
  return fill(dictionary?.[english] ?? english, values);
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
  const [dictionary, setDictionary] = useState<{ language: Language; words: Dictionary } | null>(null);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = RIGHT_TO_LEFT.includes(language) ? "rtl" : "ltr";
    if (language === "en") return;
    let current = true;
    LOADERS[language]().then((module) => {
      if (current) setDictionary({ language, words: module.default });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [language]);
  const words = dictionary?.language === language ? dictionary.words : null;
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
    // A cookie as well, because some in-app browsers clear local storage.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (english, values) => translate(words, english, values),
  }), [language, setLanguage, words]);
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
  return LANGUAGES.find(({ code }) => code === language)?.locale ?? "en-US";
}
