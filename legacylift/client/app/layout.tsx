import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "LegacyLift — Migrate legacy code without losing the why.",
  description:
    "AI-assisted legacy code migration workbench. Extract business rules, map dependencies, migrate chunk by chunk with human approval at every step.",
  keywords: ["COBOL migration", "legacy code", "AI migration", "LegacyLift"],
};

// Sets the theme class before paint to avoid a flash. Defaults to light unless
// the user has explicitly chosen dark previously.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body
          className={`${inter.variable} font-sans bg-base text-ink antialiased min-h-screen`}
        >
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
