import LiveNowBox from "./components/LiveNowBox";

export default function Home() {
  return (
    <main id="home" className="home-poster-page">
      <section className="home-poster-art sanctuary-main-page" aria-label="Sanctuary Rocks">
        <img
          className="home-poster-image sanctuary-art"
          src="/images/hero/hero3.png"
          alt="Sanctuary Rocks - Hard, Fast, and Loud"
        />
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
          href="https://discord.gg/239QyWDW4"
          target="_blank"
          rel="noopener noreferrer"
          className="home-poster-hotspot home-poster-hotspot--discord"
          aria-label="Join the Sanctuary Rocks Discord"
        />

        <div className="home-poster-player">
          <LiveNowBox />
        </div>
      </section>
    </main>
  );
}
