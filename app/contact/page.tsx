import ContactCrewCard, { type StaffSlot } from "./ContactCrewCard";
import { generalManagers, owners } from "./staffData";

const TELEPORT_URL =
  "http://maps.secondlife.com/secondlife/Rhage/160/106/24";

const GRIDSTER_URL =
  "https://gridster.elfavina89.workers.dev";

const DISCORD_URL =
  "https://discord.gg/239QyWDW4";

const VIP_APPLICATION_URL =
  "https://discord.gg/GdsJeQDnc";

// Inner photo opening of each metal frame baked into contact_hero.png.png,
// measured directly off the artwork (percent of the 1024 x 1536 image) so
// every staff photo sits flush inside its frame instead of floating over
// it. If the hero art is ever redrawn, these are the only numbers that
// need to be re-measured and updated.
const OWNER_SLOTS: StaffSlot[] = [
  { left: 13.48, top: 60.81, width: 18.26, height: 7.68 },
  { left: 40.53, top: 60.81, width: 18.55, height: 7.68 },
  { left: 68.36, top: 60.81, width: 18.36, height: 7.68 },
];

const MANAGER_SLOTS: StaffSlot[] = [
  { left: 25.88, top: 73.7, width: 18.85, height: 5.99 },
  { left: 54.49, top: 73.7, width: 18.75, height: 5.99 },
];

// Chooses which baked-in frame(s) a group of staff fills: a single person
// is centered in the middle frame, two take the outer two, and so on.
function pickSlots(slots: StaffSlot[], count: number): StaffSlot[] {
  if (count <= 0) return [];
  if (slots.length === 3 && count === 1) return [slots[1]];
  if (slots.length === 3 && count === 2) return [slots[0], slots[2]];
  return slots.slice(0, count);
}

const ownerSlots = pickSlots(OWNER_SLOTS, owners.length);
const managerSlots = pickSlots(MANAGER_SLOTS, generalManagers.length);

export default function ContactPage() {
  return (
    <main className="contact-template">

      <img
        src="/images/hero/contact_hero.png.png"
        alt="Contact Sanctuary Rocks"
        className="contact-template-image"
      />

      {owners.map((member, index) => (
        <ContactCrewCard
          key={member.name}
          member={member}
          slot={ownerSlots[index]}
        />
      ))}

      {generalManagers.map((member, index) => (
        <ContactCrewCard
          key={member.name}
          member={member}
          slot={managerSlots[index]}
        />
      ))}

      <a
        href={TELEPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Teleport to Sanctuary Rocks in Second Life"
        className="contact-hotspot"
        style={{
          left: "36%",
          top: "23.2%",
          width: "31.5%",
          height: "5%",
        }}
      />

      <a
        href={VIP_APPLICATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Apply to work at Sanctuary Rocks"
        className="contact-hotspot"
        style={{
          left: "14%",
          top: "51.4%",
          width: "34%",
          height: "4%",
        }}
      />

      <a
        href={GRIDSTER_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Visit Gridster"
        className="contact-hotspot"
        style={{
          left: "13%",
          top: "86.8%",
          width: "34.5%",
          height: "7.4%",
        }}
      />

      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join the Sanctuary Rocks Discord"
        className="contact-hotspot"
        style={{
          left: "52.5%",
          top: "86.8%",
          width: "34.5%",
          height: "7.4%",
        }}
      />

    </main>
  );
}
