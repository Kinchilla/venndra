import "./globals.css";
import type { Metadata } from "next";
import Providers from "../components/Providers";
import SiteHeader from "../components/SiteHeader";

export const metadata: Metadata = {
  title: "Venndra — find a time that works for everyone",
  description: "Calendly, but for hanging out.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF7F2] text-[#231F20] antialiased">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
