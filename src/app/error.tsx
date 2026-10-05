"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <h1>Something interrupted the forge.</h1>
      <p>Please try again. Your saved resources are safe.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
