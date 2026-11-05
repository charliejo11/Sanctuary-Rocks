"use client";

import styles from "./backstage.module.css";
import { joinNames, plural, useClubVotes } from "./useClubVotes";

// The name + line under DJ of the Week / Host of the Week: last week's crowd
// vote winner once a week has been voted, this week's leader before that, and
// the text from backstage.json until the first vote arrives.
export default function LiveWinner({ kind, name, text }: { kind: "dj" | "host"; name: string; text: string }) {
  const votes = useClubVotes();
  const r = votes?.[kind];
  let shownName = name;
  let shownText = text;
  if (r?.last_week.length) {
    shownName = joinNames(r.last_week);
    shownText = `Voted by the crowd at the club, ${r.last_week_label} (${plural(r.last_week[0].votes, "vote")}).`;
  } else if (r?.week.length) {
    const leaders = r.week.filter((s) => s.rank === 1);
    shownName = joinNames(leaders);
    shownText = `Leading this week's crowd vote with ${plural(leaders[0].votes, "vote")}. Announced every Monday.`;
  }
  return (
    <>
      <p className={styles.staffName}>{shownName}</p>
      <p className={styles.staffText}>{shownText}</p>
    </>
  );
}
