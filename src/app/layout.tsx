import type { Metadata } from "next";
import { AppNav } from "@/app/app-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mat Notes | Wrestling scouting",
  description: "Personal youth wrestling results, comparison, and scouting notes",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><AppNav />{children}</body></html>;
}


