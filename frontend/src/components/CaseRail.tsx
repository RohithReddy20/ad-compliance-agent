import { useMemo, useState } from "react";
import { MODALITY_LABEL, humanize } from "../lib";
import type { CaseWithAsset, Modality } from "../types";
import { IconPlus, VerdictBadge } from "./ui";

const ORDER: Modality[] = ["video", "image", "text"];

interface Props {
  cases: CaseWithAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  newActive: boolean;
}

export function CaseRail({ cases, selectedId, onSelect, onNew, newActive }: Props) {
  const [filter, setFilter] = useState<Modality | "all">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: cases.length };
    for (const x of cases) c[x.modality] = (c[x.modality] ?? 0) + 1;
    return c;
  }, [cases]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = cases.filter(
      (c) =>
        (filter === "all" || c.modality === filter) &&
        (!needle || `${c.id} ${c.title} ${c.company} ${c.vertical}`.toLowerCase().includes(needle)),
    );
    return ORDER.map((m) => ({ modality: m, items: visible.filter((c) => c.modality === m) })).filter(
      (g) => g.items.length,
    );
  }, [cases, filter, q]);

  return (
    <aside className="rail">
      <div className="rail-head">
        <button className={`btn ${newActive ? "primary" : ""}`} onClick={onNew} style={{ justifyContent: "center" }}>
          <IconPlus size={14} /> New ad
        </button>
        <input
          className="rail-search"
          placeholder="Search cases, companies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search golden cases"
        />
        <div className="seg" role="tablist" aria-label="Filter by modality">
          {(["all", ...ORDER] as const).map((m) => (
            <button key={m} className={filter === m ? "on" : ""} onClick={() => setFilter(m)} role="tab">
              {m === "all" ? "All" : MODALITY_LABEL[m]}
              <span className="count">{counts[m] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rail-list">
        {groups.map((g) => (
          <div key={g.modality}>
            <div className="rail-group">
              <span className="section-label">{MODALITY_LABEL[g.modality]} ads</span>
              <span className="section-label">Expected</span>
            </div>
            {g.items.map((c) => (
              <button
                key={c.id}
                className={`case-item ${c.id === selectedId ? "on" : ""}`}
                onClick={() => onSelect(c.id)}
              >
                <div className="ci-top">
                  <span className="ci-id">{c.id}</span>
                  <span style={{ marginLeft: "auto" }}>
                    <VerdictBadge verdict={c.expected_verdict} />
                  </span>
                </div>
                <div className="ci-title">{c.title}</div>
                <div className="ci-meta">
                  {shortCompany(c.company)} · {humanize(c.vertical)}
                </div>
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <p className="muted" style={{ padding: 12 }}>No cases match.</p>}
      </div>
    </aside>
  );
}

export function shortCompany(company: string): string {
  const dba = /\bdba\s+(.+)$/i.exec(company);
  if (dba) return dba[1].trim();
  return company.replace(/,?\s+(Inc\.|LLC|Ltd\.?)(?=\s|$)/g, "").replace(/\s+dba\s+.*/i, "").trim();
}
