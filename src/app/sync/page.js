"use client";

import { useMemo, useRef, useState } from "react";

function dedupeKeyOf(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

export default function SyncPage() {
  const inputRef = useRef(null);
  // Each row tracks its own checkbox state so the person can uncheck a few
  // files before syncing, or use "Chọn tất cả" to select/deselect everything
  // at once.
  const [rows, setRows] = useState([]); // { file, selected, status, message }
  const [running, setRunning] = useState(false);

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  function handlePick(e) {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    setRows(files.map((file) => ({ file, selected: true, status: "pending" })));
  }

  function toggleSelectAll(checked) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })));
  }

  function toggleOne(idx) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r))
    );
  }

  async function startSync() {
    const targets = rows
      .map((r, idx) => ({ ...r, idx }))
      .filter((r) => r.selected);
    if (targets.length === 0) return;
    setRunning(true);

    for (const target of targets) {
      const { file, idx } = target;
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, status: "uploading" } : r))
      );

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("name", file.name);
        form.append("size", String(file.size));
        form.append("lastModified", String(file.lastModified));
        form.append("mimeType", file.type);

        const res = await fetch("/api/drive/upload", { method: "POST", body: form });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Lỗi không rõ");

        if (data.skipped) {
          setRows((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, status: "skip", message: data.reason } : r
            )
          );
        } else {
          setRows((prev) =>
            prev.map((r, i) =>
              i === idx
                ? { ...r, status: "ok", message: `Đã lưu vào ${data.account}` }
                : r
            )
          );
        }
      } catch (err) {
        setRows((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, status: "error", message: err.message } : r))
        );
      }
    }

    setRunning(false);
  }

  const finishedCount = rows.filter(
    (r) => r.selected && (r.status === "ok" || r.status === "skip" || r.status === "error")
  ).length;
  const progressPct = selectedRows.length
    ? Math.round((finishedCount / selectedRows.length) * 100)
    : 0;
  const allDone =
    !running && selectedRows.length > 0 && finishedCount === selectedRows.length;

  return (
    <>
      <p className="page-eyebrow">Bước 2</p>
      <h1 className="page-title">Chọn ảnh/video để đồng bộ</h1>
      <p className="page-sub">
        Chọn ảnh/video trên máy. File nào đã từng đồng bộ trước đó sẽ tự động được bỏ
        qua. Các file còn lại sẽ lần lượt được lưu vào tài khoản Google đang trống nhiều
        dung lượng nhất.
      </p>

      <div className="card">
        <div className="card-inner stack">
          <div className="row-between">
            {rows.length > 0 ? (
              <label className="row" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
                Chọn tất cả ({selectedRows.length}/{rows.length})
              </label>
            ) : (
              <span className="field-hint">Chưa chọn file nào.</span>
            )}
            <button
              className="btn btn-ghost btn-small"
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              Chọn file...
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={handlePick}
          />

          {rows.length > 0 && (
            <div className="file-list">
              {rows.map((r, idx) => (
                <label
                  className="file-row"
                  key={dedupeKeyOf(r.file) + idx}
                  style={{ cursor: running ? "default" : "pointer" }}
                >
                  <span className="row" style={{ gap: 10, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={running}
                      onChange={() => toggleOne(idx)}
                    />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.file.name}
                    </span>
                  </span>
                  <span
                    className={`status ${
                      r.status === "ok"
                        ? "status-ok"
                        : r.status === "skip"
                        ? "status-skip"
                        : r.status === "error"
                        ? "status-error"
                        : ""
                    }`}
                  >
                    {r.status === "pending" && (r.selected ? "Chờ..." : "Bỏ qua")}
                    {r.status === "uploading" && "Đang tải lên..."}
                    {r.status === "ok" && `✓ ${r.message}`}
                    {r.status === "skip" && `⊘ ${r.message}`}
                    {r.status === "error" && `✕ ${r.message}`}
                  </span>
                </label>
              ))}
            </div>
          )}

          <button className="btn" disabled={selectedRows.length === 0 || running} onClick={startSync}>
            {running ? "Đang đồng bộ..." : `Bắt đầu đồng bộ (${selectedRows.length} file)`}
          </button>

          {selectedRows.length > 0 && (running || finishedCount > 0) && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          {allDone && (
            <div className="banner banner-ok">
              Xong! Giờ bạn có thể tự xoá các ảnh/video này khỏi máy, và xem lại trong{" "}
              <a href="/library">Thư viện</a>.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
