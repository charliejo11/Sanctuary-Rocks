import Image from "next/image";

// Homepage "Featured Artists" marquee: a slow, continuous slide of small
// bolted metal frames, each holding an artist's cover artwork. Pure CSS
// animation (see .featured-artists in globals.css), so there's no client JS
// and nothing to jitter on hydration.

type FeaturedArtist = {
  name: string;
  /** Cover art in /public (spaces URL-encoded; filenames are case-sensitive
   *  on the deployed server). Artists without one keep the drawn
   *  placeholder cover until their artwork is added. */
  image?: string;
  /** object-position for the crop. The frame opening is wider than the
   *  artwork (16:9 or 3:2), so the crop is anchored to the top by default,
   *  where most of the band logos are painted. */
  imagePosition?: string;
};

const HERO = "/images/hero";

export const FEATURED_ARTISTS: FeaturedArtist[] = [
  // Sanctuary Rocks' own featured artist leads the row.
  { name: "Maphra", image: "/images/artists/maphra.jpg", imagePosition: "50% 30%" },
  { name: "Ice Nine Kills", image: `${HERO}/ice%20nine%20kills.png` },
  { name: "Motionless in White" },
  { name: "Avenged Sevenfold" },
  { name: "Lacuna Coil" },
  { name: "In This Moment" },
  { name: "Any Given Sin" },
  { name: "Nothing More" },
  { name: "From Ashes to New" },
  { name: "Saint Asonia" },
  { name: "Pop Evil" },
  { name: "Kingdom Collapse", image: `${HERO}/kingdom%20collapse.png` },
  { name: "Sleep Theory", image: `${HERO}/sleep%20theory.png` },
  { name: "Catch Your Breath", image: `${HERO}/catch%20your%20breath.png` },
  { name: "Spiritbox", image: `${HERO}/spiritbox.png` },
  { name: "Architects", image: `${HERO}/Architects.png` },
  { name: "Bad Omens", image: `${HERO}/Bad%20Omens.png` },
  { name: "I Prevail", image: `${HERO}/i%20prevail.png` },
  // Beartooth's logo is painted across the middle of the art, not the top.
  { name: "Beartooth", image: `${HERO}/beartooth.png`, imagePosition: "50% 72%" },
  { name: "Falling in Reverse", image: `${HERO}/falling%20in%20reverse.png` },
  { name: "Wage War", image: `${HERO}/wage%20war.png` },
  { name: "Bring Me the Horizon", image: `${HERO}/Bring%20Me%20The%20Horizon.png`, imagePosition: "50% 25%" },
  { name: "Dayseeker", image: `${HERO}/Dayseeker.png` },
  { name: "The Plot in You", image: `${HERO}/The%20Plot%20In%20You.png` },
  // Polaris's logo sits mid-image; Sleep Token's runs along the bottom.
  { name: "Polaris", image: `${HERO}/Polaris.png`, imagePosition: "50% 42%" },
  { name: "Sleep Token", image: `${HERO}/Sleep%20Token.png`, imagePosition: "50% 100%" },
  { name: "Currents", image: `${HERO}/Currents.png` },
  { name: "Rain City Drive", image: `${HERO}/Rain%20City%20Drive.png` },
  { name: "Until I Wake", image: `${HERO}/Until%20I%20Wake.png` },
  { name: "Versus Me", image: `${HERO}/Versus%20Me.png` },
];

// The cover artwork already has the band's name painted in, so no name text
// is shown on the card; the name is the image's alt text and the tooltip.
// Both copies of the set render from this one list, so the looping
// duplicate always shows the same artwork in the same order.
function ArtistSet({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="featured-artists-set" aria-hidden={hidden || undefined}>
      {FEATURED_ARTISTS.map((artist) =>
        <li key={artist.name} className="featured-artist-card" title={artist.name}>
          {artist.image ? (
            <span className="featured-artist-cover featured-artist-cover--photo">
              <Image
                src={artist.image}
                alt={hidden ? "" : artist.name}
                fill
                sizes="(min-width: 1320px) 15vw, 172px"
                loading="eager"
                style={{ objectFit: "cover", objectPosition: artist.imagePosition ?? "50% 0%" }}
              />
            </span>
          ) : (
            <span className="featured-artist-cover" role="img" aria-label={artist.name} />
          )}
        </li>
      )}
    </ul>
  );
}

export default function FeaturedArtists() {
  return (
    <section className="featured-artists" aria-labelledby="featured-artists-title">
      <h2 id="featured-artists-title" className="featured-artists-title">
        <span aria-hidden="true">&#9733;</span> Featured Artists <span aria-hidden="true">&#9733;</span>
      </h2>

      <div className="featured-artists-viewport">
        {/* The list is rendered twice and the track slides exactly one
            copy's width, so the loop point is invisible. The second copy is
            hidden from screen readers so each name is announced once. */}
        <div className="featured-artists-track">
          <ArtistSet />
          <ArtistSet hidden />
        </div>
      </div>
    </section>
  );
}
