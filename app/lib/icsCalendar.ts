const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

export type IcsEvent = {
  uid?: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  rrule?: string;
  exdates: Date[];
};

export type CalendarOccurrence = Omit<IcsEvent, "rrule" | "exdates">;

type IcsEventDraft = {
  uid?: string;
  summary?: string;
  description: string;
  startValue?: string;
  startParams?: Record<string, string>;
  endValue?: string;
  endParams?: Record<string, string>;
  timeZone: string;
  rrule?: string;
  exdates: Array<{
    value: string;
    params: Record<string, string>;
  }>;
};

export function cleanText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;

  return value.trim().replace(/\s+/g, " ") || fallback;
}

export function decodeIcsText(value: string) {
  return value
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/gi, " ")
    .replace(/\\\\/g, "\\")
    .trim()
    .replace(/\s+/g, " ");
}

export function unfoldIcsLines(ics: string) {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

export function parseIcsProperty(line: string): IcsProperty | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return null;

  const rawKey = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...rawParams] = rawKey.split(";");
  const params: Record<string, string> = {};

  for (const rawParam of rawParams) {
    const equalIndex = rawParam.indexOf("=");
    if (equalIndex === -1) continue;

    const key = rawParam.slice(0, equalIndex).toUpperCase();
    params[key] = rawParam.slice(equalIndex + 1).replace(/^"|"$/g, "");
  }

  return {
    name: name.toUpperCase(),
    params,
    value,
  };
}

export function normalizeTimeZone(tzid?: string) {
  if (!tzid) return DEFAULT_TIME_ZONE;

  const unquoted = tzid.replace(/^"|"$/g, "").trim();
  const match = unquoted.match(/[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/);
  const candidate = match?.[0] ?? unquoted;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>(
    (acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    },
    {},
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

export function zonedTimeToUtc(
  dateParts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string,
) {
  const localAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    dateParts.hour,
    dateParts.minute,
    dateParts.second,
  );

  let utcDate = new Date(localAsUtc);
  let offset = getTimeZoneOffsetMs(utcDate, timeZone);
  utcDate = new Date(localAsUtc - offset);

  const adjustedOffset = getTimeZoneOffsetMs(utcDate, timeZone);
  if (adjustedOffset !== offset) {
    utcDate = new Date(localAsUtc - adjustedOffset);
  }

  return utcDate;
}

export function parseIcsDate(rawValue: string, params: Record<string, string> = {}) {
  const value = rawValue.trim();
  const timeZone = normalizeTimeZone(params.TZID);

  if (params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(value)) {
    return zonedTimeToUtc(
      {
        year: Number(value.slice(0, 4)),
        month: Number(value.slice(4, 6)),
        day: Number(value.slice(6, 8)),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone,
    );
  }

  const normalized = value.endsWith("Z") ? value.slice(0, -1) : value;
  const dateParts = {
    year: Number(normalized.slice(0, 4)),
    month: Number(normalized.slice(4, 6)),
    day: Number(normalized.slice(6, 8)),
    hour: Number(normalized.slice(9, 11) || "0"),
    minute: Number(normalized.slice(11, 13) || "0"),
    second: Number(normalized.slice(13, 15) || "0"),
  };

  if (value.endsWith("Z")) {
    return new Date(
      Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        dateParts.hour,
        dateParts.minute,
        dateParts.second,
      ),
    );
  }

  return zonedTimeToUtc(dateParts, timeZone);
}

export function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>(
    (acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    },
    {},
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

function parseRRule(rrule: string) {
  return rrule.split(";").reduce<Record<string, string>>((acc, segment) => {
    const [key, value] = segment.split("=");
    if (key && value) acc[key.toUpperCase()] = value;
    return acc;
  }, {});
}

function getDateKey(rawValue?: string) {
  const match = rawValue?.match(/^(\d{8})/);
  return match ? Number(match[1]) : 0;
}

export function formatDateKey(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  return Number(
    `${parts.year}${String(parts.month).padStart(2, "0")}${String(
      parts.day,
    ).padStart(2, "0")}`,
  );
}

function isExpiredRecurringRule(
  rrule: string,
  timeZone: string,
  now: Date,
  todayKey: number,
) {
  const rule = parseRRule(rrule);
  if (!rule.UNTIL) return false;

  const untilKey = getDateKey(rule.UNTIL);
  if (untilKey && untilKey < todayKey) return true;
  if (untilKey && untilKey > todayKey) return false;

  return parseIcsDate(rule.UNTIL, { TZID: timeZone }) < now;
}

function getDayCode(date: Date) {
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getUTCDay()];
}

function daysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isExcluded(start: Date, exdates: Date[]) {
  return exdates.some(
    (exdate) => Math.abs(exdate.getTime() - start.getTime()) < 60000,
  );
}

export function expandRecurringEvent(
  event: IcsEvent,
  now: Date,
  horizon: Date,
  maxOccurrences = 48,
): CalendarOccurrence[] {
  if (!event.rrule) {
    return [
      {
        uid: event.uid,
        summary: event.summary,
        description: event.description,
        start: event.start,
        end: event.end,
        timeZone: event.timeZone,
      },
    ];
  }

  const rule = parseRRule(event.rrule);
  const freq = rule.FREQ;
  const interval = Math.max(Number(rule.INTERVAL ?? "1"), 1);
  const durationMs = event.end.getTime() - event.start.getTime();
  const startParts = getZonedParts(event.start, event.timeZone);
  const startLocalDate = new Date(
    Date.UTC(startParts.year, startParts.month - 1, startParts.day),
  );
  const horizonParts = getZonedParts(horizon, event.timeZone);
  const horizonLocalDate = new Date(
    Date.UTC(horizonParts.year, horizonParts.month - 1, horizonParts.day),
  );
  const until = rule.UNTIL
    ? parseIcsDate(rule.UNTIL, { TZID: event.timeZone })
    : horizon;
  const count = rule.COUNT ? Number(rule.COUNT) : Number.POSITIVE_INFINITY;
  const hasFiniteCount = Number.isFinite(count);
  const byDays = (rule.BYDAY?.split(",") ?? [getDayCode(startLocalDate)]).map(
    (day) => day.replace(/^\d+/, ""),
  );
  const occurrences: CalendarOccurrence[] = [];
  let seen = 0;

  if (until < now) return occurrences;

  const windowStartParts = getZonedParts(
    new Date(Math.max(event.start.getTime(), now.getTime() - durationMs)),
    event.timeZone,
  );
  const windowStartLocalDate = new Date(
    Date.UTC(
      windowStartParts.year,
      windowStartParts.month - 1,
      windowStartParts.day,
    ),
  );
  const firstCursor =
    !hasFiniteCount && windowStartLocalDate > startLocalDate
      ? windowStartLocalDate
      : startLocalDate;

  for (
    let cursor = firstCursor;
    cursor <= horizonLocalDate && seen < count && occurrences.length < maxOccurrences;
    cursor = addUtcDays(cursor, 1)
  ) {
    const elapsedDays = daysBetween(startLocalDate, cursor);
    let matches = false;

    if (freq === "DAILY") {
      matches = elapsedDays >= 0 && elapsedDays % interval === 0;
    }

    if (freq === "WEEKLY") {
      const elapsedWeeks = Math.floor(elapsedDays / 7);
      matches =
        elapsedDays >= 0 &&
        elapsedWeeks % interval === 0 &&
        byDays.includes(getDayCode(cursor));
    }

    if (freq === "MONTHLY") {
      const elapsedMonths =
        (cursor.getUTCFullYear() - startLocalDate.getUTCFullYear()) * 12 +
        cursor.getUTCMonth() -
        startLocalDate.getUTCMonth();

      matches =
        elapsedMonths >= 0 &&
        elapsedMonths % interval === 0 &&
        cursor.getUTCDate() === startLocalDate.getUTCDate();
    }

    if (!matches) continue;

    const start = zonedTimeToUtc(
      {
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
        hour: startParts.hour,
        minute: startParts.minute,
        second: startParts.second,
      },
      event.timeZone,
    );

    const end = new Date(start.getTime() + durationMs);
    seen += 1;

    if (start > until || end < now || isExcluded(start, event.exdates)) continue;

    occurrences.push({
      uid: event.uid,
      summary: event.summary,
      description: event.description,
      start,
      end,
      timeZone: event.timeZone,
    });
  }

  return occurrences;
}

export function isValidIcsCalendar(ics: string) {
  return /BEGIN:VCALENDAR/i.test(ics);
}

export function parseCalendarEvents(
  ics: string,
  now: Date,
  defaultTimeZone = DEFAULT_TIME_ZONE,
): IcsEvent[] {
  const lines = unfoldIcsLines(ics);
  const events: IcsEvent[] = [];
  const todayKey = formatDateKey(now, defaultTimeZone);
  let currentEvent: IcsEventDraft | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = {
        description: "",
        exdates: [],
        timeZone: defaultTimeZone,
      };
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEvent?.summary && currentEvent.startValue) {
        const timeZone = currentEvent.timeZone ?? defaultTimeZone;
        const endDateKey =
          getDateKey(currentEvent.endValue) || getDateKey(currentEvent.startValue);

        if (!currentEvent.rrule && endDateKey && endDateKey < todayKey) {
          currentEvent = null;
          continue;
        }

        if (
          currentEvent.rrule &&
          isExpiredRecurringRule(currentEvent.rrule, timeZone, now, todayKey)
        ) {
          currentEvent = null;
          continue;
        }

        const start = parseIcsDate(
          currentEvent.startValue,
          currentEvent.startParams,
        );
        const end = currentEvent.endValue
          ? parseIcsDate(currentEvent.endValue, currentEvent.endParams)
          : new Date(start.getTime() + 2 * 60 * 60 * 1000);

        if (!currentEvent.rrule && end < now) {
          currentEvent = null;
          continue;
        }

        events.push({
          uid: currentEvent.uid,
          summary: currentEvent.summary,
          description: currentEvent.description ?? "",
          start,
          end,
          timeZone,
          rrule: currentEvent.rrule,
          exdates: currentEvent.exdates.map((exdate) =>
            parseIcsDate(exdate.value, exdate.params),
          ),
        });
      }

      currentEvent = null;
      continue;
    }

    if (!currentEvent) continue;

    const property = parseIcsProperty(line);
    if (!property) continue;

    if (property.name === "UID") {
      currentEvent.uid = decodeIcsText(property.value);
    }

    if (property.name === "SUMMARY") {
      currentEvent.summary = decodeIcsText(property.value);
    }

    if (property.name === "DESCRIPTION") {
      currentEvent.description = decodeIcsText(property.value);
    }

    if (property.name === "DTSTART") {
      currentEvent.timeZone = normalizeTimeZone(property.params.TZID);
      currentEvent.startValue = property.value;
      currentEvent.startParams = property.params;
    }

    if (property.name === "DTEND") {
      currentEvent.endValue = property.value;
      currentEvent.endParams = property.params;
    }

    if (property.name === "RRULE") {
      currentEvent.rrule = property.value;
    }

    if (property.name === "EXDATE") {
      const exdates = property.value
        .split(",")
        .map((date) => ({
          value: date,
          params: property.params,
        }));
      currentEvent.exdates = [...(currentEvent.exdates ?? []), ...exdates];
    }
  }

  return events;
}

export function findLiveOccurrence(
  events: IcsEvent[],
  now: Date,
): CalendarOccurrence | null {
  for (const event of events) {
    const occurrence = expandRecurringEvent(event, now, now).find(
      (candidate) => candidate.start <= now && candidate.end > now,
    );

    if (occurrence) return occurrence;
  }

  return null;
}
