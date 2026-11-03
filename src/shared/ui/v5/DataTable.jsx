import { useState } from "react";
import { Badge, Button, EmptyState, Icon, IconButton } from "./components.jsx";
import { filterRows } from "./model.js";

/** Search, status filtering, selection, sorting and pagination share one derived result set. */
export default function DataTable({
  rows,
  onInspect,
  onBulkChange,
  readOnly = false,
  requestTable = false,
  compact = false,
  valueLabel = "Details",
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState([]);
  const [sort, setSort] = useState({
    key: requestTable ? "time" : "name",
    ascending: !requestTable,
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  const filtered = filterRows(rows, query, status).sort(
    (a, b) =>
      String(a[sort.key]).localeCompare(String(b[sort.key]), "en", {
        numeric: true,
      }) * (sort.ascending ? 1 : -1),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const selectedVisible = filtered
    .filter((row) => selected.includes(row.id))
    .map((row) => row.id);
  const allSelected =
    visible.length > 0 && visible.every((row) => selected.includes(row.id));
  const toggle = (id) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  const columns = [
    { key: "name", label: requestTable ? "Model / route" : "Name" },
    { key: "status", label: "Status" },
    { key: "value", label: requestTable ? "Tokens" : valueLabel },
    {
      key: requestTable ? "latency" : "time",
      label: requestTable ? "Latency" : "Last activity",
    },
  ];
  return (
    <div className={`v5-table-block ${compact ? "v5-table-compact" : ""}`}>
      <div className="v5-table-toolbar">
        <label className="v5-search-field">
          <Icon name="search" />
          <input
            aria-label="Search table"
            placeholder={
              requestTable
                ? "Search model, provider, request…"
                : "Search by name…"
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">All statuses</option>
          {[...new Set(rows.map((row) => row.status))].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        {query || status !== "all" ? (
          <Button
            onClick={() => {
              setQuery("");
              setStatus("all");
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        ) : (
          <span className="v5-muted">
            {rows.length} {requestTable ? "requests" : "items"}
          </span>
        )}
      </div>
      {selectedVisible.length > 0 && (
        <div className="v5-selection-bar">
          <strong>{selectedVisible.length} selected</strong>
          {!readOnly && onBulkChange && (
            <Button
              onClick={() => {
                onBulkChange(selectedVisible);
                setSelected([]);
              }}
              icon="pause"
            >
              Disable selected
            </Button>
          )}
          <Button onClick={() => setSelected([])}>Clear selection</Button>
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          icon="search_off"
          title="No matching results"
          description="Try another search or remove the status filter."
          action={
            <Button
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div
          className="v5-table-scroll"
          tabIndex={0}
          aria-label="Scrollable results"
        >
          <table>
            <thead>
              <tr>
                {!compact && (
                  <th className="v5-check-cell">
                    <input
                      type="checkbox"
                      aria-label="Select this page"
                      checked={allSelected}
                      onChange={() =>
                        setSelected((previous) =>
                          allSelected
                            ? previous.filter(
                                (id) => !visible.some((row) => row.id === id),
                              )
                            : [
                                ...new Set([
                                  ...previous,
                                  ...visible.map((row) => row.id),
                                ]),
                              ],
                        )
                      }
                    />
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    aria-sort={
                      sort.key === column.key
                        ? sort.ascending
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      onClick={() =>
                        setSort({
                          key: column.key,
                          ascending:
                            sort.key === column.key ? !sort.ascending : true,
                        })
                      }
                    >
                      {column.label}
                      <Icon
                        name={
                          sort.key === column.key
                            ? sort.ascending
                              ? "arrow_upward"
                              : "arrow_downward"
                            : "unfold_more"
                        }
                        size={14}
                      />
                    </button>
                  </th>
                ))}
                <th>
                  <span className="v5-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} data-selected={selected.includes(row.id)}>
                  {!compact && (
                    <td className="v5-check-cell">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                  )}
                  <td>
                    <button
                      className="v5-row-link"
                      onClick={() => onInspect(row)}
                    >
                      {row.name}
                    </button>
                    <small>{row.detail}</small>
                  </td>
                  <td>
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="v5-numeric">{row.value}</td>
                  <td className="v5-numeric v5-muted">
                    {requestTable ? row.latency : row.time}
                  </td>
                  <td>
                    <IconButton
                      label={`Inspect ${row.name}`}
                      icon="arrow_forward"
                      onClick={() => onInspect(row)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="v5-pagination">
        <span>
          {filtered.length ? currentPage * pageSize + 1 : 0}–
          {Math.min((currentPage + 1) * pageSize, filtered.length)} of{" "}
          {filtered.length}
        </span>
        <label>
          Rows{" "}
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        </label>
        <IconButton
          label="Previous page"
          icon="chevron_left"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        />
        <IconButton
          label="Next page"
          icon="chevron_right"
          disabled={currentPage >= pages - 1}
          onClick={() => setPage(currentPage + 1)}
        />
      </div>
    </div>
  );
}
