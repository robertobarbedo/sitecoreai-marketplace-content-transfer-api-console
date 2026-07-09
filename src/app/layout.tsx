import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Transfer Console",
  description:
    "SitecoreAI Marketplace console for migrating content between environments via the Content Transfer and Item Transfer APIs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans text-sm antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
