import "./globals.css";
import type { Metadata } from "next";
import Providers from "../components/Providers";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

export const metadata: Metadata = {
  title: "Venndra | Find a time that works for everyone",
  description: "Automated scheduling for friend groups.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF7F2] text-[#231F20] antialiased">
        <Providers>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
