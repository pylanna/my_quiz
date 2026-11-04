export interface ResultRow {
  rank: number;
  nickname: string;
  score: number;
  correctCount: number;
  correctTimeMs: number;
}

function cell(value: string): string {
  // Neutralise spreadsheet formula injection from player-chosen nicknames.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function resultsToCsv(rows: ResultRow[]): string {
  const lines = ["rank,nickname,score,correct_answers,correct_time_seconds"];
  for (const r of rows) {
    lines.push(
      [r.rank, cell(r.nickname), r.score, r.correctCount, (r.correctTimeMs / 1000).toFixed(2)].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
