import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import SiteHeader from "./components/SiteHeader";
import { sanctuaryContent } from "./data/sanctuaryContent";

export const metadata: Metadata = {
  title: sanctuaryContent.site.name,
  description: sanctuaryContent.site.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
