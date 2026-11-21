// Song metadata from the SR SHOUTcast v1 stream (/7.html), e.g.
//   "DJ Frenchie Fry @ Sanctuary Rocks - Combichrist - What The Fuck Is Wrong With You"   (live DJ)
//   "3 Doors Down - Kryptonite"                                                          (autoplay)
//   "DJ Frenchie Fry @ Sanctuary Rocks - Coke, Fry, Cheeseburger Intro"                  (talk / jingle)

// "@ Sanctuary Rocks", "@ SR", "@ S.R." ... (DJs shorten the venue)
const DJ_PREFIX = /^\s*(?:dj|djane)\s+(.+?)\s*@\s*(?:sanctuary\s*rocks|s\.?\s*r\.?)\s*[-|:]\s*/i;
// ... or the tag at the end: "Aephanemer - Panta Rhei DJ PEACY @ SR"
const DJ_SUFFIX = /[\s-]+(?:dj|djane)\s+([^-]+?)\s*@\s*(?:sanctuary\s*rocks|s\.?\s*r\.?)\s*$/i;

/** Parse the 7th CSV field of /7.html into {raw, djTag, artist, title, live, isSong}. Never invents data. */
export function parseStreamTitle(raw) {
  const r = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!r) return null;
  let djTag = null;
  let rest = r;
  const m = r.match(DJ_PREFIX);
  const s = m ? null : r.match(DJ_SUFFIX);
  if (m) {
    djTag = m[1].trim();
    rest = r.slice(m[0].length).trim();
  } else if (s) {                                   // "Artist - Title DJ NAME @ SR"
    djTag = s[1].trim();
    rest = r.slice(0, s.index).trim();
  }
  const i = rest.indexOf(" - ");
  const artist = i > 0 ? rest.slice(0, i).trim() : "";
  const title = i > 0 ? rest.slice(i + 3).trim() : rest;
  return { raw: r, djTag, artist, title, live: djTag !== null, isSong: artist !== "" && title !== "" };
}

/** Parse a /7.html body: "26,1,162,200,25,128,TITLE" (the title may itself contain commas). */
export function parseSevenHtml(body) {
  const text = String(body ?? "").replace(/<[^>]*>/g, "").trim();
  const parts = text.split(",");
  if (parts.length < 7) return null;
  const n = parts.slice(0, 6).map((x) => Number.parseInt(x, 10));
  if (n.some((x) => Number.isNaN(x))) return null;
  return {
    listeners: n[0], online: n[1] === 1, peak: n[2], max: n[3], unique: n[4], bitrate: n[5],
    title: parts.slice(6).join(",").trim(),
  };
}

// Version words that make a DIFFERENT recording (kept in the key); everything else in brackets is dropped
const VERSION_WORDS = ["live", "remix", "mix", "cover", "acoustic", "demo", "instrumental", "unplugged", "orchestral", "extended", "rework"];

function basic(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Artist: drop "feat./ft./featuring ..." guests, "The " prefix; "AC/DC" == "ACDC". */
export function normalizeArtist(artist) {
  const a = String(artist ?? "").split(/\s*(?:\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0];
  return basic(a).replace(/^the /, "").replace(/\s/g, "");
}

/** Title: keep version tags (live, remix, cover...), drop "remastered 2011", "explicit", "radio edit" etc. */
export function normalizeTitle(title) {
  let t = String(title ?? "");
  const tags = new Set();
  t = t.replace(/[([]([^)\]]*)[)\]]/g, (_, inner) => {
    const w = basic(inner).split(" ");
    for (const v of VERSION_WORDS) if (w.includes(v)) tags.add(v);
    return " ";
  });
  // " - Live at Wacken", " - 2011 Remaster"
  const dash = t.split(/\s+-\s+/);
  if (dash.length > 1) {
    const tail = basic(dash.slice(1).join(" ")).split(" ");
    for (const v of VERSION_WORDS) if (tail.includes(v)) tags.add(v);
    t = dash[0];
  }
  const base = basic(t.split(/\s*(?:\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0]);
  return { base, tags: [...tags].sort() };
}

// Station announcements, jingles, adverts and placeholder metadata are never songs (Backstage Pass 2.0, section 4).
// Kept deliberately narrow: whole words only, so real songs with "Intro" or "Promo" in a longer title aren't lost.
const STATION_ARTISTS = new Set(["sanctuaryrocks", "sanctuaryrocksradio", "sr", "srradio", "unknown", "unknownartist", "various", "variousartists", "na", "null", "undefined"]);
// (not bare numbers or "Untitled": "1979", "2112" and several "Untitled" tracks are real songs)
const NOT_A_SONG = /^(?:station\s*id|jingle|liner|sweeper|advert(?:isement)?|commercial|ad\s*break|promo|ident|id|track\s*\d+)$/i;
const NOT_A_SONG_ANYWHERE = /\b(?:station\s*id|station\s*ident|jingle|sweeper|advertisement|commercial\s*break)\b/i;

// DJ mic breaks, as the club's DJs actually label them (seen on the stream, 2026-11): the DJ's own name as the artist
// ("DJ IcyHexx - Speak I Must", "DjRichbo - This is the Way", "!! DJ CANDI !! - Bla Bla Bla"), talking / chatter /
// voice-over words ("Y - is Y talking", "Kova Is Talking!"), the venue in the metadata ("... @ SR CLUB",
// "At Sanctuary Rocks With ..."), or a DJ intro ("Tomwolf22 - DJ Teags Intro").
const DJ_ARTIST = /(?:^|[^a-z])(?:dj|djane)(?=[\s\-_.!'’]|$)|\bhost\s+\w/i;
const DJ_GLUED = /^\W*D[jJ][A-Z]/;   // "DjRichbo" (case-sensitive, so the bands Django Django / Djinn stay songs)
const TALK = /\bis\s+(?:\w+\s+)?talking\b|\btalking\s*!|\bchatter(?:ing)?\b|\bvoice\s*-?\s*over\b|\bon\s+the\s+mic\b|\bmic\s+break\b|\bshout\s*-?\s*outs?\b/i;
const VENUE = /@\s*(?:sr\b|s\.r\.|sanctuary)|\bat\s+sanctuary\s+rocks\b/i;
const DJ_INTRO = /\b(?:dj|djane)\b.*\b(?:intro|outro)\b|\b(?:intro|outro)\b.*\b(?:dj|djane)\b/i;
const DASH_INTRO = /\s-\s*(?:intro|outro)\s*$/i;   // "Dafinya - Intro" (a set intro; a track simply called "Intro" stays a song)
// More voice-over labels, as they slipped onto the charts (2026-11-21): "Kova is Yappin' - Mick Gordon - Rip & Tear",
// "Blah...Blah..Blah - Miami Vice Theme Song", "Tap...Tap..of the Mic...is This Thing On??? (The Crystal Method) - Bones
// Theme", "Rock On!! - The Incredible Hulk Theme", "HalfTime Fuckery!!! (Dextron) - Suck My Wobble": the DJ's own words
// in the artist slot, talking over a bed track. ("Ramble On", "Talk Dirty to Me" stay songs: "is" has to come first.)
const TALK_MORE = /\bis\s+(?:\w+\s+)?(?:yappin[g']?|rambling|babbling|chatting)(?=\W|$)|\byappin[g']?(?=\W|$)|\bblah\W+blah\b|\btap\W+tap\b|\bis\s+this\s+thing\s+on\b|\bmic\s*check\b/i;
// Shouted / trailing-off artist slots: "Rock On!!", "Thing On???", "Blah...Blah..". Artist only, and it takes TWO
// ".." runs, so the band "...And You Will Know Us by the Trail of Dead" (and "Panic! At the Disco") stay songs.
const SHOUTY_ARTIST = /[!?]{2,}|\.{2,}.*\.{2,}/;

/** A DJ talking / introducing themselves rather than playing a song. */
export function isMicBreak(artist, title) {
  const a = String(artist ?? ""), t = String(title ?? "");
  return DJ_ARTIST.test(a) || DJ_GLUED.test(a) || TALK.test(a) || TALK.test(t) || VENUE.test(a) || VENUE.test(t) || DJ_INTRO.test(t) || DASH_INTRO.test(t)
    || TALK_MORE.test(a) || TALK_MORE.test(t) || SHOUTY_ARTIST.test(a);
}

/** True when parsed stream metadata is an announcement / jingle / advert / mic break / placeholder rather than a song. */
export function isNonSong(artist, title) {
  const a = normalizeArtist(artist);
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!a || !t) return true;
  if (STATION_ARTISTS.has(a)) return true;
  if (isMicBreak(artist, t)) return true;
  return NOT_A_SONG.test(t) || NOT_A_SONG_ANYWHERE.test(t) || NOT_A_SONG_ANYWHERE.test(String(artist ?? ""));
}

const xmlTag = (xml, tag) => {
  const m = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() : null;
};

/**
 * Parse SHOUTcast 2 /stats?sid=1 (XML). Besides the title it carries what the CONNECTED SOURCE sends: SERVERTITLE (the
 * DJ encoder's station name, e.g. "DJ Frenchie Fy @ Sanctuary Rocks") and, from SAM Broadcaster, SONGURL with
 * songtype (S = song; I/J/P/A/N/V/X... = station id, jingle, promo, advert, news, voice, fx) and duration in ms.
 */
export function parseStatsXml(xml) {
  if (!/<SHOUTCASTSERVER>/i.test(String(xml ?? ""))) return null;
  const n = (t) => { const v = Number.parseInt(xmlTag(xml, t) ?? "", 10); return Number.isNaN(v) ? 0 : v; };
  const songUrl = xmlTag(xml, "SONGURL") ?? "";
  const q = new URLSearchParams(songUrl.replace(/^[^&]*&/, ""));
  const st = (q.get("songtype") ?? "").trim().toUpperCase();
  const dur = Number.parseInt(q.get("duration") ?? "", 10);
  return {
    listeners: n("CURRENTLISTENERS"), online: n("STREAMSTATUS") === 1, peak: n("PEAKLISTENERS"), max: n("MAXLISTENERS"),
    unique: n("UNIQUELISTENERS"), bitrate: n("BITRATE"),
    title: xmlTag(xml, "SONGTITLE") ?? "", serverTitle: xmlTag(xml, "SERVERTITLE") ?? "",
    songType: /^[A-Z]$/.test(st) ? st : null, durationMs: Number.isFinite(dur) && dur > 0 ? dur : null,
  };
}

/** The DJ name in an encoder station name: "DJ Frenchie Fy @ Sanctuary Rocks" -> "Frenchie Fy". Null if none. */
export function djFromServerTitle(serverTitle) {
  const m = String(serverTitle ?? "").match(/^\s*(?:dj|djane)\s+(.+?)\s*(?:@|$)/i);
  return m ? m[1].trim() || null : null;
}

/** One chart identity per recording: "artist|title[|tags]". Null when it isn't a real song. */
export function songKey(artist, title) {
  if (isNonSong(artist, title)) return null;
  const a = normalizeArtist(artist);
  const t = normalizeTitle(title);
  if (!a || !t.base) return null;
  return t.tags.length ? `${a}|${t.base}|${t.tags.join(",")}` : `${a}|${t.base}`;
}

/** Does the DJ name in the stream metadata plausibly match the logged-in DJ's name? */
export function djNameMatches(djTag, boardName) {
  const a = basic(djTag).replace(/^dj /, "").replace(/\s/g, "");
  const b = basic(boardName).replace(/^dj /, "").replace(/\s/g, "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
