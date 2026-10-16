"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";
import { LanguageProvider, useT } from "@/lib/i18n";
import { ClanBrand } from "./clan-brand";
import { LanguagePicker } from "./language-picker";
import "./apply.css";

type Form = { gameName: string; discordName: string; power: string; stage: string; server: string; timezone: string; warDays: string; languages: string; about: string; website: string };
const EMPTY: Form = { gameName: "", discordName: "", power: "", stage: "", server: "", timezone: "", warDays: "", languages: "", about: "", website: "" };
const FIELDS: { key: keyof Form; label: string; hint: string; max: number; required?: boolean }[] = [
  { key: "gameName", label: "In-game name", hint: "Exactly as it shows in Forge Master", max: 40, required: true },
  { key: "discordName", label: "Discord username", hint: "So leadership can message you", max: 40, required: true },
  { key: "power", label: "Power", hint: "e.g. 797t", max: 20 },
  { key: "stage", label: "Highest stage", hint: "e.g. Hard 11-2", max: 20 },
  { key: "server", label: "Server", hint: "e.g. Server 27", max: 20 },
  { key: "timezone", label: "Time zone", hint: "e.g. UTC+10", max: 20 },
  { key: "warDays", label: "War days you can play each week", hint: "e.g. 6 of 7", max: 20 },
  { key: "languages", label: "Languages you speak", hint: "e.g. English, Spanish", max: 80 },
];

export function ApplyPage() {
  return <LanguageProvider><Apply /></LanguageProvider>;
}

function Apply() {
  const t = useT();
  const [form, setForm] = useState<Form>(EMPTY);
  const [open, setOpen] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    fetch("/api/applications/open", { cache: "no-store" }).then((response) => response.json()).then((result) => setOpen(result.open !== false)).catch(() => setOpen(true));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }
  return <main className="apply-page">
    <header className="apply-top">
      <Link href="/" className="apply-brand"><ClanBrand decorative size={40} /><strong>TURMOIL</strong></Link>
      <LanguagePicker />
    </header>
    <section className="apply-card">
      <ClanBrand variant="full" className="apply-crest" size={110} sizes="110px" decorative />
      {sent ? <div className="apply-done">
        <CheckCircle2 size={36} />
        <h1>{t("Application sent!")}</h1>
        <p>{t("Thanks for applying. Turmoil leadership will look at it and message you on Discord.")}</p>
      </div> : <>
        <h1>{t("Join Turmoil")}</h1>
        <p className="apply-intro">{t("Tell us a bit about you. It takes about a minute, and you don’t need to sign in.")}</p>
        {open === false ? <div className="error-banner" role="alert">{t("Turmoil isn’t taking applications right now. Check back soon.")}</div> : <form onSubmit={submit} className="apply-form">
          <div className="apply-grid">
            {FIELDS.map((field) => <label key={field.key}>
              <span>{t(field.label)}{field.required && <b aria-hidden="true"> *</b>}</span>
              <input value={form[field.key]} maxLength={field.max} required={field.required} placeholder={t(field.hint)}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
            </label>)}
          </div>
          <label className="apply-about">
            <span>{t("Why Turmoil? Anything else we should know?")}</span>
            <textarea value={form.about} maxLength={1000} rows={4} onChange={(event) => setForm({ ...form, about: event.target.value })} />
          </label>
          {/* Hidden from people; spam bots fill it in and get refused. */}
          <input className="apply-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
          {error && <div className="error-banner" role="alert">{t(error)}</div>}
          <button className="button primary apply-send" disabled={sending || !form.gameName.trim() || form.discordName.trim().length < 2}>
            {sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}{t("Send application")}
          </button>
        </form>}
      </>}
    </section>
    <p className="apply-footer">{t("THE TURMOIL WAY")}</p>
  </main>;
}
