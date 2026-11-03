import { CompareBuilder } from "@/app/compare-builder";
import { configured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default function Home() {
  if (!configured()) {
    return (
      <main className="page-shell setup-screen">
        <span className="eyebrow">MAT NOTES · PERSONAL WORKSPACE</span>
        <h1>Connect the results database to begin.</h1>
        <p>The server configuration is incomplete. No results or credentials are exposed in the browser.</p>
      </main>
    );
  }

  return <CompareBuilder />;
}

