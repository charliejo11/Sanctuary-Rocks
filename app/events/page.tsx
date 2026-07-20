import eventsData from "../data/events.json";

type EventItem = {
  date: string;
  day: string;
  time: string;
  title: string;
  dj: string;
  host: string;
  description: string;
  badge?: string;
};

type SponsorItem = {
  name: string;
  image?: string;
  url?: string;
  side?: "left" | "right";
};

const data = eventsData as {
  month: string;
  headline: string;
  events: EventItem[];
  sponsors?: SponsorItem[];
};

function getDateParts(date: string): { month: string; day: string } {
  const [month = "", ...dayParts] = date.split(" ");

  return {
    month,
    day: dayParts.join(" "),
  };
}

function formatBadge(badge?: string): string {
  return badge ? badge.replace(/-/g, " ") : "event";
}

export default function EventsPage() {
  const sponsors = data.sponsors ?? [];

  return (
    <main className="events-page events-template-page">
      <section className="events-template-shell" aria-labelledby="events-title">
        <div className="events-template-scroll">
          <div className="events-template-board">
            <img
              className="events-template-image"
              src="/images/hero/events-calandar.png"
              alt=""
              aria-hidden="true"
            />

            <h1 id="events-title" className="events-template-heading">
              {data.headline}
            </h1>

            <p className="events-template-month" aria-label={`Event month ${data.month}`}>
              {data.month}
            </p>

            {data.events.length === 0 ? (
              <p className="events-template-empty">
                No upcoming events yet — check back soon.
              </p>
            ) : (
            <ol className="events-template-list" aria-label={`${data.month} events`}>
              {data.events.slice(0, 6).map((event, index) => {
                const dateParts = getDateParts(event.date);

                return (
                  <li
                    className={`events-template-event events-template-event--${index + 1}`}
                    key={`${event.date}-${event.title}`}
                  >
                    <div className="events-template-date">
                      <span>{event.day}</span>
                      <strong>{dateParts.day}</strong>
                      <em>{dateParts.month}</em>
                    </div>

                    <div className="events-template-copy">
                      <h2>{event.title}</h2>
                      <p className="events-template-meta">
                        <span>{event.time}</span>
                        <span>{event.dj}</span>
                        <span>{event.host}</span>
                      </p>
                      <p className="events-template-description">{event.description}</p>
                    </div>

                    <div className="events-template-badge" aria-label={formatBadge(event.badge)}>
                      <span>{formatBadge(event.badge)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            )}

            {sponsors.map((sponsor, index) => {
              const side = sponsor.side ?? (index % 2 === 0 ? "left" : "right");

              return (
                <a
                  className={`events-template-sponsor events-template-sponsor--${side} events-template-sponsor--slot-${index + 1}`}
                  href={sponsor.url ?? "#"}
                  key={`${sponsor.name}-${index}`}
                  aria-label={sponsor.name}
                >
                  {sponsor.image ? (
                    <img src={sponsor.image} alt={sponsor.name} />
                  ) : (
                    <span>{sponsor.name}</span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
