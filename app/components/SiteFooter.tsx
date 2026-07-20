export function SiteFooter() {
  return (
    <footer className="site-footer" id="crew">
      <span id="contact" className="site-footer-contact-anchor" aria-hidden="true" />
      <img
        className="site-footer-image"
        src="/images/hero/footer-final.png.png"
        alt="Sanctuary Rocks footer"
      />
      {/* TODO: replace with real link */}
      <a
        href="/crew"
        className="join-crew-hotspot"
        aria-label="Join the Sanctuary Rocks crew"
      />
      {/* TODO: replace with real link */}
      <a
        href="#facebook-coming-soon"
        className="footer-social-hotspot footer-social-hotspot--facebook"
        aria-label="Sanctuary Rocks Facebook coming soon"
      />
      {/* TODO: replace with real link */}
      <a
        href="#discord-coming-soon"
        className="footer-social-hotspot footer-social-hotspot--discord"
        aria-label="Sanctuary Rocks Discord coming soon"
      />
    </footer>
  );
}
