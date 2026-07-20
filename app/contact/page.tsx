import ContactPhoto from "./ContactPhoto";
import { loadManagers, loadOwners } from "../data/crew";
import { normalizeForMatch } from "../data/crewTypes";

// Force a fresh render on every request so newly added owner/manager photos
// show up without a rebuild.
export const dynamic = "force-dynamic";

const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";
const LINKTREE_URL = "https://linktr.ee/SanctuaryRocks?subscribe";
const DISCORD_URL = "https://discord.gg/239QyWDW4";
const DJ_APPLICATION_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf9Rgq2ulADGGgFUFG0ZUit3TxNgC5JtTQAQxbcOGo3jBJDHA/viewform";
const HOST_APPLICATION_URL = DJ_APPLICATION_URL;

type Box = { left: number; top: number; width: number; height: number };

// Percentages measured directly against contact_hero.png.png (1024x1536),
// matching the three OWNER frames and two GENERAL MANAGER frames baked
// into the artwork, left-to-right.
const OWNER_FRAMES: Box[] = [
  { left: 13, top: 61, width: 19, height: 7.8 },
  { left: 40, top: 61, width: 20, height: 7.8 },
  { left: 67.5, top: 61, width: 19.5, height: 7.8 },
];

const MANAGER_FRAMES: Box[] = [
  { left: 23.5, top: 74, width: 23, height: 5.5 },
  { left: 53.5, top: 74, width: 23, height: 5.5 },
];

// The manager/owner frames are much wider than they are tall, while a few
// of the current photos are tall vertical portraits - a plain center crop
// on those would show mostly hair. Nudge the crop toward the face for the
// ones that need it, keyed by normalized name.
const OBJECT_POSITION_OVERRIDES: Record<string, string> = {
  jamye: "center 22%",
  iggy: "center 20%",
};

function FramedPhoto({ box, name, image }: { box: Box; name: string; image: string }) {
  return (
    <div
      className="contact-photo"
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      }}
    >
      <ContactPhoto
        src={image}
        alt={name}
        objectPosition={OBJECT_POSITION_OVERRIDES[normalizeForMatch(name)]}
      />
    </div>
  );
}

export default function ContactPage() {
  const owners = loadOwners().slice(0, OWNER_FRAMES.length);
  const managers = loadManagers().slice(0, MANAGER_FRAMES.length);

  return (
    <main className="contact-template">
      <img
        src="/images/hero/contact_hero.png.png"
        alt="Contact Sanctuary Rocks - questions, or ready to join the crew?"
        className="contact-template-image"
      />

      {owners.map((owner, index) => (
        <FramedPhoto key={owner.image} box={OWNER_FRAMES[index]} name={owner.name} image={owner.image} />
      ))}

      {managers.map((manager, index) => (
        <FramedPhoto key={manager.image} box={MANAGER_FRAMES[index]} name={manager.name} image={manager.image} />
      ))}

      <a
        href={TELEPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Teleport to Sanctuary Rocks in Second Life"
        className="contact-hotspot"
        style={{ left: "36%", top: "23.2%", width: "31.5%", height: "5%" }}
      />

      <a
        href={DJ_APPLICATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Apply to become a Sanctuary Rocks DJ"
        className="contact-hotspot"
        style={{ left: "14%", top: "51.4%", width: "21%", height: "2.6%" }}
      />

      <a
        href={HOST_APPLICATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Apply to become a Sanctuary Rocks host"
        className="contact-hotspot"
        style={{ left: "62.5%", top: "51.4%", width: "22%", height: "2.6%" }}
      />

      <a
        href={LINKTREE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open the Sanctuary Rocks Linktree"
        className="contact-hotspot"
        style={{ left: "13%", top: "86.8%", width: "34.5%", height: "7.4%" }}
      />

      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join the Sanctuary Rocks Discord"
        className="contact-hotspot"
        style={{ left: "52.5%", top: "86.8%", width: "34.5%", height: "7.4%" }}
      />
    </main>
  );
}
