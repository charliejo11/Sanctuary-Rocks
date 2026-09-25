import Link from "next/link";
import { sanctuaryContent } from "../data/sanctuaryContent";

type SanctuaryLogoProps = {
  size?: "small" | "large";
};

export function SanctuaryLogo({ size = "small" }: SanctuaryLogoProps) {
  const { logo } = sanctuaryContent;

  return (
    <Link className={`sanctuary-logo sanctuary-logo-${size}`} href={logo.homeHref} aria-label={logo.ariaLabel}>
      <span className="logo-fire-glow" aria-hidden="true" />
      <img className="logo-image" src={logo.imageSrc} alt="" aria-hidden="true" />
      <span className="logo-embers" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
    </Link>
  );
}
