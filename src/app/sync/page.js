"use client";

import { useMemo, useRef, useState } from "react";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function dedupeKeyOf(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

export default function SyncPage() {
  const inputRef = useRef(null);
  const [allFiles, setAllFiles] = useState([]);
  const [rows, setRows] = useState([]); // { file, status: pending|skip|ok|error, message, account }
  const [running, setRunning] = useState(false);
  const [onlyThisWeek, setOnlyThisWeek] = useState(true);

  const filtered = useMemo(() => {
    if (!onlyThisWeek) return allFiles;
    const cutoff = Date.now() - WEEK_MS;
    return allFiles.filter((f) => f.lastModified >= cutoff);
  }, [allFiles, onlyThisWeek]);

  function handlePick(e) {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    setAllFiles(files);
    setRows(files.map((file) => ({ file, status: "pending" })));
  }

  async function startSync() {
    if (filtered.length === 0) return;
    setRunning(true);
    const toRun = filtered.map((file) => ({ file, status: "pending" }));
    setRows(toRun);

    for (let i = 0; i < toRun.length; i++) {
      const { file } = toRun[i];
      setRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "uploading" } : r))
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
            prev.map((r, idx) =>
              idx === i ? { ...r, status: "skip", message: data.reason } : r
            )
          );
        } else {
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, status: "ok", message: `Đã lưu vào ${data.account}` } : r
            )
          );
        }
      } catch (err) {
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "error", message: err.message } : r))
        );
      }
    }

    setRunning(false);
  }

  const doneCount = rows.filter((r) => r.status !== "pending" && r.status !== "uploading").length;
  const progressPct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;

  return (
    <>
      <p className="page-eyebrow">Bước 2</p>
      <h1 className="page-title">Chọn ảnh/video để đồng bộ</h1>
      <p className="page-sub">
        Chọn ảnh/video gần đây trên máy. File nào đã từng đồng bộ trước đó sẽ tự động được
        bỏ qua. Các file còn lại sẽ lần lượt được lưu vào tài khoản Google đang trống nhiều
        dung lượng nhất.
      </p>

      <div className="card">
        <div className="card-inner stack">
          <div className="row-between">
            <label className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={onlyThisWeek}
                onChange={(e) => setOnlyThisWeek(e.target.checked)}
              />
              Chỉ lấy ảnh/video của tuần này
            </label>
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

          {allFiles.length > 0 && (
            <p className="meta">
              Đã chọn {allFiles.length} file — {filtered.length} file khớp bộ lọc hiện tại.
            </p>
          )}

          <button className="btn" disabled={filtered.length === 0 || running} onClick={startSync}>
            {running ? "Đang đồng bộ..." : `Bắt đầu đồng bộ (${filtered.length} file)`}
          </button>

          {rows.length > 0 && (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="file-list">
                {rows.map((r, idx) => (
                  <div className="file-row" key={dedupeKeyOf(r.file) + idx}>
                    <span>{r.file.name}</span>
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
                      {r.status === "pending" && "Chờ..."}
                      {r.status === "uploading" && "Đang tải lên..."}
                      {r.status === "ok" && `✓ ${r.message}`}
                      {r.status === "skip" && `⊘ ${r.message}`}
                      {r.status === "error" && `✕ ${r.message}`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!running && doneCount > 0 && doneCount === rows.length && (
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
