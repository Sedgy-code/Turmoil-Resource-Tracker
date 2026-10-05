import Link from "next/link";
export default function NotFound() {
  return (
    <main className="fatal-error">
      <h1>This path is uncharted.</h1>
      <p>The page you’re looking for doesn’t exist.</p>
      <Link className="button primary" href="/">
        Return to dashboard
      </Link>
    </main>
  );
}
