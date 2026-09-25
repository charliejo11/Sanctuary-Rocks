import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./player-fix.css";
import { SanctuaryAudioProvider } from "./components/audio/SanctuaryAudio";
import DragonCursor from "./components/DragonCursor";
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
        {/* One persistent live-radio session for every page. */}
        <SanctuaryAudioProvider>
          <SiteHeader />
          {children}
        </SanctuaryAudioProvider>
        <DragonCursor />
        <SpeedInsights />
      </body>
    </html>
  );
}

