import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "LegacyLift — Legacy code. Finally understood.",
  description:
    "AI-assisted legacy code migration workbench. Extract business rules, map dependencies, migrate chunk by chunk with human approval at every step.",
  keywords: ["COBOL migration", "legacy code", "AI migration", "LegacyLift"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans bg-[#0a0a0a] text-white antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
