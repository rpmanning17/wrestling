import Link from "next/link";

export function AppNav() {
  return (
    <header className="app-header">
      <Link href="/" className="brand" aria-label="Mat Notes compare home">MAT NOTES</Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Compare</Link>
        <Link href="/rankings">Rankings</Link>
        <Link href="/results">Results</Link>
      </nav>
    </header>
  );
}

