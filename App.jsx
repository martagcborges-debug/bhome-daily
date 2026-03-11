import { useState, useEffect, useRef, useCallback } from "react";

// ── Audio Engine ──────────────────────────────────────────────────────────────
function playCompletionSound(ctx, stopSignal) {
  if (!ctx) return;

  let stopped = false;
  stopSignal.stop = () => { stopped = true; };

  function playRound(offset) {
    if (stopped) return;
    const now = ctx.currentTime + offset;

    // Clapping bursts
    for (let i = 0; i < 8; i++) {
      if (stopped) break;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / data.length);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass"; filter.frequency.value = 1200; filter.Q.value = 0.8;
      src.buffer = buf;
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.6, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.15);
      src.start(now + i * 0.18);
    }

    // Firework whistles + pops
    const fireworks = [
      { freq: 200, time: 0.2 }, { freq: 280, time: 0.6 }, { freq: 320, time: 1.0 },
      { freq: 260, time: 1.3 }, { freq: 350, time: 1.7 },
    ];
    fireworks.forEach(({ freq, time }) => {
      if (stopped) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);
      osc.frequency.exponentialRampToValueAtTime(freq * 4, now + time + 0.3);
      g.gain.setValueAtTime(0.3, now + time);
      g.gain.exponentialRampToValueAtTime(0.001, now + time + 0.3);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now + time); osc.stop(now + time + 0.35);

      const pbuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      const pd = pbuf.getChannelData(0);
      for (let j = 0; j < pd.length; j++) pd[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.02));
      const ps = ctx.createBufferSource();
      const pg = ctx.createGain();
      const pf = ctx.createBiquadFilter();
      pf.type = "lowpass"; pf.frequency.value = 800;
      ps.buffer = pbuf;
      pg.gain.setValueAtTime(0.8, now + time + 0.31);
      pg.gain.exponentialRampToValueAtTime(0.001, now + time + 0.45);
      ps.connect(pf); pf.connect(pg); pg.connect(ctx.destination);
      ps.start(now + time + 0.31);

      [0, 100, 200, 350].forEach((dt) => {
        if (stopped) return;
        const so = ctx.createOscillator();
        const sg = ctx.createGain();
        so.type = "sine";
        so.frequency.value = freq * 4 + Math.random() * 300;
        sg.gain.setValueAtTime(0.15, now + time + 0.32 + dt / 1000);
        sg.gain.exponentialRampToValueAtTime(0.001, now + time + 0.32 + dt / 1000 + 0.3);
        so.connect(sg); sg.connect(ctx.destination);
        so.start(now + time + 0.32 + dt / 1000);
        so.stop(now + time + 0.32 + dt / 1000 + 0.35);
      });
    });

    // Schedule next round after 2.4s unless stopped
    setTimeout(() => { if (!stopped) playRound(0); }, (offset + 2400));
  }

  playRound(0);
}

// ── Data ──────────────────────────────────────────────────────────────────────
const ZONES = {
  weekday: [
    { id: "kitchen", label: "Kitchen", duration: 25 * 60 },
    { id: "living", label: "Living Room", duration: 10 * 60 },
    { id: "bedrooms", label: "Bedrooms", duration: 10 * 60 },
    { id: "hall", label: "Hall", duration: 5 * 60 },
    { id: "wc", label: "WC", duration: 5 * 60 },
  ],
  weekend: [
    { id: "living", label: "Living Room", duration: 30 * 60 },
    { id: "bedrooms", label: "Bedrooms", duration: 30 * 60, altDuration: 40 * 60 },
    { id: "kitchen", label: "Kitchen & Laundry", duration: 60 * 60 },
    { id: "wc", label: "WC", duration: 20 * 60 },
    { id: "hall", label: "Hall", duration: 10 * 60 },
  ],
};

const ZONE_COLORS = {
  kitchen: "#C8A97A",
  living: "#8FB5A1",
  bedrooms: "#A89BC4",
  hall: "#D4A5A5",
  wc: "#7BAEC4",
};

function fmt(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("bhome_history") || "{}"); }
  catch { return {}; }
}

function saveHistory(h) {
  try { localStorage.setItem("bhome_history", JSON.stringify(h)); } catch {}
}

// ── Components ────────────────────────────────────────────────────────────────

function TimerModal({ zone, mode, onClose, onComplete }) {
  const [useAlt, setUseAlt] = useState(false);
  const duration = useAlt ? zone.altDuration : zone.duration;
  const [remaining, setRemaining] = useState(duration);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const soundStopRef = useRef({});

  useEffect(() => {
    setRemaining(duration);
    setDone(false);
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [duration]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            setDone(true);
            if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
            soundStopRef.current = {};
            playCompletionSound(audioRef.current, soundStopRef.current);
            onComplete(zone.id, mode);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const pct = ((duration - remaining) / duration) * 100;
  const r = 110;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,12,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, backdropFilter: "blur(12px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#13131A", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 28, padding: "48px 56px", textAlign: "center",
        minWidth: 360, position: "relative",
        boxShadow: `0 0 80px ${ZONE_COLORS[zone.id]}22`,
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: 18, right: 22, background: "none",
          border: "none", color: "#666", fontSize: 22, cursor: "pointer", lineHeight: 1,
        }}>×</button>

        <div style={{ fontSize: 11, letterSpacing: 4, color: "#666", marginBottom: 6, textTransform: "uppercase" }}>
          {mode === "weekday" ? "Weekday" : "Weekend"}
        </div>
        <div style={{ fontSize: 20, fontFamily: "'Cormorant Garamond', serif", color: "#E8E4DC", marginBottom: 32 }}>
          {zone.label}
        </div>

        {zone.altDuration && !running && !done && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 24 }}>
            {[{ label: "30 min", val: false }, { label: "40 min", val: true }].map(({ label, val }) => (
              <button key={label} onClick={() => setUseAlt(val)} style={{
                padding: "6px 18px", borderRadius: 20, fontSize: 12, letterSpacing: 1,
                border: useAlt === val ? `1px solid ${ZONE_COLORS[zone.id]}` : "1px solid #333",
                background: useAlt === val ? `${ZONE_COLORS[zone.id]}22` : "transparent",
                color: useAlt === val ? ZONE_COLORS[zone.id] : "#666", cursor: "pointer",
              }}>{label}</button>
            ))}
          </div>
        )}

        <div style={{ position: "relative", display: "inline-block", marginBottom: 32 }}>
          <svg width={260} height={260} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={130} cy={130} r={r} fill="none" stroke="#1E1E28" strokeWidth={8} />
            <circle cx={130} cy={130} r={r} fill="none"
              stroke={ZONE_COLORS[zone.id]} strokeWidth={8}
              strokeDasharray={`${dash} ${circ}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.9s linear", filter: `drop-shadow(0 0 8px ${ZONE_COLORS[zone.id]}88)` }}
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            {done ? (
              <div style={{ fontSize: 36, animation: "pulse 0.6s ease infinite alternate" }}>🎉</div>
            ) : (
              <>
                <div style={{
                  fontSize: 52, fontFamily: "'Cormorant Garamond', serif",
                  color: "#E8E4DC", letterSpacing: -1, lineHeight: 1,
                }}>{fmt(remaining)}</div>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginTop: 4 }}>
                  {running ? "RUNNING" : "PAUSED"}
                </div>
              </>
            )}
          </div>
        </div>

        {done ? (
          <div>
            <div style={{ color: ZONE_COLORS[zone.id], fontSize: 15, marginBottom: 20, letterSpacing: 1 }}>
              Zone complete ✓
            </div>
            <button onClick={() => { if (soundStopRef.current) soundStopRef.current.stop?.(); onClose(); }} style={{
              background: ZONE_COLORS[zone.id], color: "#0D0D12",
              border: "none", borderRadius: 12, padding: "12px 32px",
              fontSize: 13, letterSpacing: 2, cursor: "pointer", fontWeight: 700,
            }}>DONE</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={() => setRunning(!running)} style={{
              background: running ? "transparent" : ZONE_COLORS[zone.id],
              color: running ? ZONE_COLORS[zone.id] : "#0D0D12",
              border: `1px solid ${ZONE_COLORS[zone.id]}`,
              borderRadius: 12, padding: "12px 36px",
              fontSize: 13, letterSpacing: 2, cursor: "pointer", fontWeight: 700,
              transition: "all 0.2s",
            }}>{running ? "PAUSE" : "START"}</button>
            <button onClick={() => { setRemaining(duration); setRunning(false); setDone(false); }} style={{
              background: "transparent", color: "#555",
              border: "1px solid #2A2A35", borderRadius: 12, padding: "12px 20px",
              fontSize: 13, cursor: "pointer",
            }}>↺</button>
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { from { transform: scale(1); } to { transform: scale(1.15); } }`}</style>
    </div>
  );
}

function ZoneCard({ zone, mode, completed, onOpen }) {
  const accent = ZONE_COLORS[zone.id];
  const mins = zone.duration / 60;
  const altMins = zone.altDuration ? zone.altDuration / 60 : null;

  return (
    <button onClick={onOpen} style={{
      background: completed ? `${accent}12` : "#0F0F17",
      border: `1px solid ${completed ? accent : "#1E1E2A"}`,
      borderRadius: 16, padding: "22px 24px",
      display: "flex", alignItems: "center", gap: 18,
      cursor: "pointer", textAlign: "left", width: "100%",
      transition: "all 0.25s", position: "relative", overflow: "hidden",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = `${accent}18`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = completed ? accent : "#1E1E2A"; e.currentTarget.style.background = completed ? `${accent}12` : "#0F0F17"; }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: `${accent}20`, border: `1px solid ${accent}44`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: accent, opacity: completed ? 1 : 0.5 }} />
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, color: "#E8E4DC", fontFamily: "'Cormorant Garamond', serif", marginBottom: 3 }}>
          {zone.label}
        </div>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>
          {altMins ? `${mins} – ${altMins} min` : `${mins} min`}
        </div>
      </div>

      {completed && (
        <div style={{ fontSize: 11, color: accent, letterSpacing: 2 }}>✓ DONE</div>
      )}

      {!completed && (
        <div style={{
          fontSize: 11, color: "#444", letterSpacing: 1,
          border: "1px solid #2A2A35", borderRadius: 8, padding: "4px 10px",
        }}>START</div>
      )}
    </button>
  );
}

function CalendarView({ history }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function dayKey(d) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function getScore(d) {
    const k = dayKey(d);
    if (!history[k]) return 0;
    const total = history[k].total || 0;
    const done = history[k].done || 0;
    return total > 0 ? done / total : 0;
  }

  return (
    <div style={{ background: "#0F0F17", border: "1px solid #1E1E2A", borderRadius: 20, padding: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
          style={{ background: "none", border: "none", color: "#666", fontSize: 18, cursor: "pointer" }}>‹</button>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#E8E4DC" }}>
          {monthNames[month]} {year}
        </div>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
          style={{ background: "none", border: "none", color: "#666", fontSize: 18, cursor: "pointer" }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#444", letterSpacing: 1, padding: "4px 0" }}>{d}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const score = getScore(d);
          const isToday = dayKey(d) === todayKey();
          const accent = score === 1 ? "#8FB5A1" : score > 0 ? "#C8A97A" : "#1E1E2A";
          return (
            <div key={i} style={{
              aspectRatio: "1", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: isToday ? "#E8E4DC" : score > 0 ? "#bbb" : "#444",
              background: score > 0 ? `${accent}22` : "transparent",
              border: isToday ? "1px solid #C8A97A" : `1px solid ${score > 0 ? accent + "44" : "transparent"}`,
              position: "relative",
            }}>
              {d}
              {score === 1 && <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "#8FB5A1" }} />}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 20, justifyContent: "center" }}>
        {[["#8FB5A1", "Complete"], ["#C8A97A", "Partial"], ["#1E1E2A", "No data"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ history }) {
  const entries = Object.entries(history);
  const totalDays = entries.length;
  const completeDays = entries.filter(([, v]) => v.done === v.total && v.total > 0).length;
  const streak = (() => {
    let s = 0, d = new Date();
    while (true) {
      const k = d.toISOString().slice(0, 10);
      if (history[k]?.done > 0) { s++; d.setDate(d.getDate() - 1); } else break;
    }
    return s;
  })();
  const totalZones = entries.reduce((a, [, v]) => a + (v.done || 0), 0);

  const stats = [
    { label: "Days Tracked", value: totalDays },
    { label: "Full Days", value: completeDays },
    { label: "Day Streak", value: streak },
    { label: "Zones Done", value: totalZones },
  ];

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const k = d.toISOString().slice(0, 10);
    const v = history[k];
    return {
      label: d.toLocaleDateString("en", { weekday: "short" }),
      pct: v && v.total > 0 ? v.done / v.total : 0,
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{
            background: "#0F0F17", border: "1px solid #1E1E2A",
            borderRadius: 16, padding: "20px 22px",
          }}>
            <div style={{ fontSize: 32, fontFamily: "'Cormorant Garamond', serif", color: "#E8E4DC" }}>{value}</div>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 1, marginTop: 4 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#0F0F17", border: "1px solid #1E1E2A", borderRadius: 20, padding: 24 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 20 }}>LAST 7 DAYS</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 80 }}>
          {last7.map(({ label, pct }) => (
            <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ width: "100%", borderRadius: 4, background: "#1E1E2A", height: 60, display: "flex", alignItems: "flex-end" }}>
                <div style={{
                  width: "100%", borderRadius: 4,
                  background: pct === 1 ? "#8FB5A1" : pct > 0 ? "#C8A97A" : "#1E1E2A",
                  height: `${Math.max(pct * 100, 4)}%`,
                  transition: "height 0.6s ease",
                }} />
              </div>
              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>{label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState("weekday");
  const [tab, setTab] = useState("home");
  const [activeTimer, setActiveTimer] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [, forceUpdate] = useState(0);

  const todayHistory = history[todayKey()] || { done: 0, total: 0, zones: {} };
  const zones = ZONES[mode];

  function handleComplete(zoneId, m) {
    setHistory(prev => {
      const k = todayKey();
      const day = prev[k] || { done: 0, total: 0, zones: {} };
      if (day.zones[`${m}_${zoneId}`]) return prev;
      const updated = {
        ...prev,
        [k]: {
          ...day,
          done: day.done + 1,
          total: Math.max(day.total, day.done + 1),
          zones: { ...day.zones, [`${m}_${zoneId}`]: true },
        },
      };
      saveHistory(updated);
      return updated;
    });
  }

  function isCompleted(zoneId) {
    return !!(todayHistory.zones?.[`${mode}_${zoneId}`]);
  }

  const completedCount = zones.filter(z => isCompleted(z.id)).length;
  const pct = zones.length > 0 ? completedCount / zones.length : 0;

  const tabs = [
    { id: "home", label: "Today" },
    { id: "calendar", label: "Calendar" },
    { id: "stats", label: "Stats" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A10",
      color: "#E8E4DC", fontFamily: "'DM Sans', sans-serif",
      display: "flex", flexDirection: "column", maxWidth: 480,
      margin: "0 auto", position: "relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "32px 24px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 5, color: "#555", marginBottom: 4 }}>B H O M E</div>
          <div style={{ fontSize: 28, fontFamily: "'Cormorant Garamond', serif", letterSpacing: -0.5, lineHeight: 1 }}>
            Daily
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>
            {new Date().toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
          </div>
          {tab === "home" && (
            <div style={{ fontSize: 11, color: "#8FB5A1", marginTop: 4 }}>
              {completedCount}/{zones.length} zones
            </div>
          )}
        </div>
      </div>

      {/* Progress bar (home only) */}
      {tab === "home" && (
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ height: 2, background: "#1E1E2A", borderRadius: 2 }}>
            <div style={{
              height: "100%", borderRadius: 2, background: "#8FB5A1",
              width: `${pct * 100}%`, transition: "width 0.6s ease",
              boxShadow: "0 0 8px #8FB5A188",
            }} />
          </div>
        </div>
      )}

      {/* Mode toggle */}
      {tab === "home" && (
        <div style={{ display: "flex", padding: "20px 24px 0", gap: 8 }}>
          {["weekday", "weekend"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "10px", borderRadius: 12, fontSize: 12, letterSpacing: 2,
              border: mode === m ? "1px solid #C8A97A" : "1px solid #1E1E2A",
              background: mode === m ? "#C8A97A18" : "transparent",
              color: mode === m ? "#C8A97A" : "#555",
              cursor: "pointer", transition: "all 0.2s",
            }}>
              {m === "weekday" ? "WEEKDAY" : "WEEKEND"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, padding: "20px 24px 100px", display: "flex", flexDirection: "column", gap: 10 }}>
        {tab === "home" && zones.map(zone => (
          <ZoneCard
            key={zone.id + mode}
            zone={zone}
            mode={mode}
            completed={isCompleted(zone.id)}
            onOpen={() => setActiveTimer(zone)}
          />
        ))}

        {tab === "calendar" && <CalendarView history={history} />}
        {tab === "stats" && <Dashboard history={history} />}
      </div>

      {/* Bottom nav */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
        background: "rgba(10,10,16,0.95)", backdropFilter: "blur(20px)",
        borderTop: "1px solid #1E1E2A", padding: "12px 24px 20px",
        display: "flex", justifyContent: "space-around",
      }}>
        {tabs.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 4, padding: "4px 20px",
          }}>
            <div style={{
              width: 4, height: 4, borderRadius: "50%",
              background: tab === id ? "#C8A97A" : "transparent", marginBottom: 2,
            }} />
            <div style={{
              fontSize: 11, letterSpacing: 2,
              color: tab === id ? "#C8A97A" : "#555",
            }}>{label.toUpperCase()}</div>
          </button>
        ))}
      </div>

      {/* Timer Modal */}
      {activeTimer && (
        <TimerModal
          zone={activeTimer}
          mode={mode}
          onClose={() => setActiveTimer(null)}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
