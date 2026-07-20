import type { SanctuaryHeroContent } from "../data/sanctuaryContent";

type SanctuaryHeroProps = {
  content: SanctuaryHeroContent;
};

export function SanctuaryHero({ content }: SanctuaryHeroProps) {
  return <section className="hero-shell" aria-label={content.headline} />;
}
