import { schedulePercent } from "../lib/cohort-standing";

export function GlickoMetrics({ rating, rd, conservative, status, schedule, opponent }: {
  rating: number | null; rd: number | null; conservative: number | null;
  status: string | null; schedule: number | null; opponent: number | null;
}) {
  return <section className="glicko-metrics" aria-label="Global Glicko rating and schedule">
    <dl className="facts">
      <div><dt>Glicko Rating</dt><dd>{rating == null ? "Unrated" : rating.toFixed(0)}</dd></div>
      <div><dt>Rating Deviation (RD)</dt><dd>{rd == null ? "Unavailable" : rd.toFixed(0)}</dd></div>
      <div><dt>Conservative Glicko Rating</dt><dd>{conservative == null ? "Unavailable" : conservative.toFixed(0)}</dd></div>
      <div><dt>Rating status</dt><dd className={`rating-status ${status ?? ""}`}>{status ?? "Unrated"}</dd></div>
      <div><dt>Schedule Difficulty</dt><dd>{schedulePercent(schedule)}</dd></div>
      <div><dt>Average Opponent Glicko Rating</dt><dd>{opponent == null ? "Unavailable" : opponent.toFixed(0)}</dd></div>
    </dl>
    <p className="metric-help">Glicko Rating starts at 1,500 with no fixed upper limit. RD measures uncertainty. Conservative Glicko Rating subtracts the configured uncertainty adjustment.</p>
    <p className="metric-help">Schedule Difficulty: expected win % for a reference 1,500-rated wrestler; lower means harder opposition.</p>
  </section>;
}
