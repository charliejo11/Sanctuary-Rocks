"use client";

import { useEffect, useState } from "react";

// Vote Board results (DJ / Host of the Week and Month, Most Requested, Recent
// Shoutouts) from this site's own backend. One request a minute is shared by
// every part of the page that shows them.
export type Standing = { rank: number; name: string; votes: number; photo_url: string | null };
type Ranking = { week: Standing[]; month: Standing[]; last_week: Standing[]; last_month: Standing[]; last_week_label: string; last_month_label: string };
export type SongRequest = { rank: number; artist: string; title: string; requests: number };
export type Shoutout = { to: string; text: string; from: string | null; at: number };
export type ClubVotes = {
  week_label: string;
  month_label: string;
  dj: Ranking;
  host: Ranking;
  requests: { week: SongRequest[]; month: SongRequest[] };
  shoutouts: Shoutout[];
};

let cache: ClubVotes | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<(v: ClubVotes) => void>();

async function load() {
  try {
    const d = await fetch("/api/sr2/public/votes", { cache: "no-store" }).then((r) => r.json());
    if (!d?.dj) return;
    cache = d;
    listeners.forEach((f) => f(d));
  } catch {
    /* keep the last good reading */
  }
}

export function useClubVotes() {
  const [votes, setVotes] = useState<ClubVotes | null>(cache);
  useEffect(() => {
    listeners.add(setVotes);
    if (listeners.size === 1) {
      load();
      timer = setInterval(load, 60000);
    }
    return () => {
      listeners.delete(setVotes);
      if (!listeners.size) clearInterval(timer);
    };
  }, []);
  return votes;
}

export const joinNames = (list: Standing[]) => list.map((s) => s.name).join(" & ");
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
