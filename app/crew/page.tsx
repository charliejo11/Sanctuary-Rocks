import CrewCarouselOverlay from "../components/CrewCarouselOverlay";
import SponsorCard from "../components/SponsorCard";
import { loadDjs, loadHosts, loadSponsors } from "../data/crew";
import { shuffleCrew } from "../data/crewTypes";

// Force a fresh render (and a fresh shuffle) on every request/refresh,
// instead of Next.js statically caching a single random order at build time.
export const dynamic = "force-dynamic";

export default function CrewPage() {
  const djs = shuffleCrew(loadDjs());
  const hosts = shuffleCrew(loadHosts());
  const sponsors = loadSponsors();

  return (
    <main className="crew-image-page">
      <div className="crew-poster-wrap">
        <img
          src="/images/hero/crew_hero.png"
          alt="Sanctuary Rocks - Meet the Crew"
          className="crew-page-image"
        />

        <CrewCarouselOverlay djs={djs} hosts={hosts} />
      </div>

      {sponsors.length > 0 ? (
        <section className="crew-sponsors" aria-label="Sponsors">
          <h2 className="crew-sponsors-heading">
            <span>Sponsors</span>
          </h2>
          <div className="crew-sponsors-grid">
            {sponsors.map((sponsor) => (
              <SponsorCard key={sponsor.image} sponsor={sponsor} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
