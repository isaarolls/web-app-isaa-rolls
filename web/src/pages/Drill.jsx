import React from "react";
import { qs } from "../api.js";
import * as F from "../fmt.js";
import { DataTable, ErrorBox, Loading, Modal, navigate, useData } from "../ui.jsx";

const LINKS = { sale: (r) => `/vendite/${r.id}`, expense: (r) => `/spese/${r.id}`, item: (r) => `/magazzino/${r.id}` };

/** Elenco delle operazioni che compongono un numero (dashboard e report). */
export function DrillModal({ metric, from, to, title, onClose }) {
  const { data, error, loading } = useData(`/drill${qs({ metric, from, to })}`);
  const link = data?.link && LINKS[data.link];
  return (
    <Modal title={title || data?.title || "Dettaglio"} onClose={onClose} size="xl">
      <p className="muted small">Periodo: {F.date(from)} – {F.date(to)}{data?.note ? `. ${data.note}` : ""}</p>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && (
        <DataTable columns={data.columns} rows={data.rows}
          onRowClick={link ? (r) => { if (r.id) { onClose(); navigate(link(r)); } } : undefined}
          footer={() => (
            <tr>
              {data.columns.map((c, i) => (
                <td key={c.key} className={c.key === data.total_key ? "r" : ""}>
                  {i === 0 ? "Totale" : c.key === data.total_key ? F.eur(data.total) : ""}
                </td>
              ))}
            </tr>
          )} />
      )}
    </Modal>
  );
}
