import FeaturedArtists from "./components/FeaturedArtists";
import SanctuaryPlayer from "./components/SanctuaryPlayer";

export default function Home() {
  return (
    <main id="home" className="home-poster-page">
      {/* The stage holds the hero plus the two overlays. On wide screens the
          player and Featured Artists sit over the empty frames painted into
          the hero; on narrower screens they drop into normal flow underneath
          it. The hero section itself is always exactly the image's height, so
          its percentage-positioned hotspots stay aligned either way. */}
      <div className="home-hero-stage">
        <section className="home-poster-art sanctuary-main-page" aria-label="Sanctuary Rocks">
          <img
            className="home-poster-image sanctuary-art"
            src="/images/hero/sanctuary%20home%20hero.png"
            alt="Sanctuary Rocks - Second Life's Rock & Metal Club. Hard Rock, Heavy Metal, Always Loud"
          />
          <span className="hero-gradient-overlay" aria-hidden="true" />
          <span className="castle-glow" aria-hidden="true" />
          <span className="dragon-smoke" aria-hidden="true" />
          <span className="dragon-smoke smoke-two" aria-hidden="true" />
          <span className="road-fire" aria-hidden="true" />
          <span className="road-fire road-fire-two" aria-hidden="true" />
          <span id="crew" className="home-poster-anchor home-poster-anchor--crew" />
          <span id="contact" className="home-poster-anchor home-poster-anchor--contact" />
          <a
            href="https://discord.gg/239QyWDW4"
            target="_blank"
            rel="noopener noreferrer"
            className="home-poster-hotspot home-poster-hotspot--vip"
            aria-label="Get Sanctuary Rocks VIP Access"
          />
          <a
            href="https://linktr.ee/SanctuaryRocks?subscribe"
            target="_blank"
            rel="noopener noreferrer"
            className="home-poster-hotspot home-poster-hotspot--facebook"
            aria-label="Visit Sanctuary Rocks on Facebook"
          />
          <a
            href="https://gridster.elfavina89.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="home-poster-hotspot home-poster-hotspot--gridster"
            aria-label="Visit Gridster"
          />
        </section>

        <div className="home-poster-player">
          <SanctuaryPlayer />
        </div>

        <FeaturedArtists />
      </div>
    </main>
  );
}
