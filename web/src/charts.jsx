import React, { useState } from "react";
import * as F from "./fmt.js";

function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const short = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString("it-IT", { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
};

/**
 * Grafico a barre raggruppate con linea opzionale.
 * series: [{key, label, color}], line: {key, label, color}, data: [{label, ...}]
 */
export function BarChart({ data, series, line, height = 230, onBarClick }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = height, L = 46, R = 10, T = 12, B = 28;
  const vals = data.flatMap((d) => [...series.map((s) => Number(d[s.key] || 0)), line ? Number(d[line.key] || 0) : 0]);
  const max = niceMax(Math.max(0, ...vals));
  const minRaw = Math.min(0, ...vals);
  const min = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const n = data.length || 1;
  const gw = (W - L - R) / n;
  const bw = Math.max(2, Math.min(26, (gw * 0.72) / series.length));
  const ticks = 4;
  const labelEvery = Math.ceil(n / 14);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Grafico">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = min + ((max - min) * i) / ticks;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid-line" strokeDasharray={v === 0 ? "" : "3 3"} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{short(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x0 = L + gw * i + (gw - bw * series.length) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onClick={onBarClick ? () => onBarClick(d) : undefined} style={{ cursor: onBarClick ? "pointer" : "default" }}>
              <rect x={L + gw * i} y={T} width={gw} height={H - T - B} fill={hover === i ? "rgba(29,36,51,.04)" : "transparent"} />
              {series.map((s, j) => {
                const v = Number(d[s.key] || 0);
                return <rect key={s.key} x={x0 + j * bw} y={Math.min(y(v), y(0))} width={bw - 1.5} height={Math.max(1, Math.abs(y(v) - y(0)))}
                  rx={Math.min(3, bw / 3)} fill={s.color} />;
              })}
              {i % labelEvery === 0 && <text x={L + gw * i + gw / 2} y={H - 8} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        {line && (
          <>
            <polyline fill="none" stroke={line.color} strokeWidth="2.2" strokeLinejoin="round"
              points={data.map((d, i) => `${L + gw * i + gw / 2},${y(Number(d[line.key] || 0))}`).join(" ")} />
            {data.map((d, i) => <circle key={i} cx={L + gw * i + gw / 2} cy={y(Number(d[line.key] || 0))} r={hover === i ? 4.5 : 2.8} fill={line.color} />)}
          </>
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div className="chart-tip" style={{ left: `${((L + gw * hover + gw / 2) / W) * 100}%` }}>
          <b>{data[hover].tip || data[hover].label}</b>
          {series.map((s) => <div key={s.key}><i style={{ background: s.color }} />{s.label}: {F.eur(data[hover][s.key])}</div>)}
          {line && <div><i style={{ background: line.color }} />{line.label}: {F.eur(data[hover][line.key])}</div>}
        </div>
      )}
      <div className="legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        {line && <span><i style={{ background: line.color, height: 3, borderRadius: 2 }} />{line.label}</span>}
      </div>
    </div>
  );
}

/** Barre orizzontali per classifiche (prodotti, categorie, canali). */
export function BarList({ items, value, label, format = F.eur, sub, onClick, max: maxIn }) {
  const max = maxIn || Math.max(1e-9, ...items.map((i) => Math.abs(Number(value(i)) || 0)));
  return (
    <div className="bar-list">
      {items.map((it, k) => {
        const v = Number(value(it)) || 0;
        return (
          <div className="bar-row" key={k} onClick={onClick ? () => onClick(it) : undefined} style={onClick ? { cursor: "pointer" } : undefined}>
            <span title={label(it)} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(it)}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(1, (Math.abs(v) / max) * 100)}%`,
              background: v < 0 ? "var(--bad)" : undefined }} /></span>
            <span className="v">{format(v)}{sub && <span className="muted small"> {sub(it)}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}
