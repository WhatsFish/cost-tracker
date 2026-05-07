import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cost — ai-native",
  description: "AI cost tracking — Claude Code agent runs and Azure AI Foundry calls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
