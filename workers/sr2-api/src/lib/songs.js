// Song metadata from the SR SHOUTcast v1 stream (/7.html), e.g.
//   "DJ Frenchie Fry @ Sanctuary Rocks - Combichrist - What The Fuck Is Wrong With You"   (live DJ)
//   "3 Doors Down - Kryptonite"                                                          (autoplay)
//   "DJ Frenchie Fry @ Sanctuary Rocks - Coke, Fry, Cheeseburger Intro"                  (talk / jingle)

// "@ Sanctuary Rocks", "@ SR", "@ S.R." ... (DJs shorten the venue)
const DJ_PREFIX = /^\s*dj\s+(.+?)\s*@\s*(?:sanctuary\s*rocks|s\.?\s*r\.?)\s*[-|:]\s*/i;
// ... or the tag at the end: "Aephanemer - Panta Rhei DJ PEACY @ SR"
const DJ_SUFFIX = /[\s-]+dj\s+([^-]+?)\s*@\s*(?:sanctuary\s*rocks|s\.?\s*r\.?)\s*$/i;

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

/** One chart identity per recording: "artist|title[|tags]". Null when it isn't a real song. */
export function songKey(artist, title) {
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
