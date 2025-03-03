import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "../lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "PathLens",
  description: "Internet path observability dashboard"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-b from-white/80 to-[#eef3f8] min-h-screen text-ink font-sans">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
