import { memo } from "react";
import { useNexaEvents } from "@/nexa/store";
function time(value: string) { return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
export const ThoughtStream = memo(function ThoughtStream() {
  const events = useNexaEvents().slice(0, 8);
  return <section className="thought-panel" aria-labelledby="thought-title">
    <div className="panel-heading"><span>THOUGHT STREAM</span><span className="signal-bars" aria-hidden="true">▮▮▮</span></div>
    <div className="thought-list" id="thought-title" aria-live="polite">
      {events.length ? events.map((event, index) => <article className="thought-row" key={event.id} style={{ opacity: Math.max(.34, 1 - index * .09) }}>
        <time>{time(event.timestamp)}</time><span className={`priority-dot priority-${event.priority}`} />
        <p>{String(event.data['message'] ?? event.type)}</p><code>{event.id.slice(0, 18)}</code>
      </article>) : <div className="quiet-state"><span className="quiet-pulse" />Waiting for the next verifiable chain event.</div>}
    </div>
  </section>;
});
