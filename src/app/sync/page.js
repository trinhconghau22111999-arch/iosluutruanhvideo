"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function dedupeKeyOf(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

// Uploads a single file, retrying once if the request fails outright (e.g. a
// brief network drop while the phone was switching apps). A server-side
// error response (not a network failure) is not retried, since retrying
// wouldn't change the outcome.
async function uploadWithRetry(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name);
  form.append("size", String(file.size));
  form.append("lastModified", String(file.lastModified));
  form.append("mimeType", file.type);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/drive/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi không rõ");
      return data;
    } catch (err) {
      if (attempt === 1) throw err;
      // Wait a moment before the single retry — gives a flaky connection a
      // chance to recover.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export default function SyncPage() {
  const inputRef = useRef(null);
  // Each row tracks its own checkbox state so the person can uncheck a few
  // files before syncing, or use "Chọn tất cả" to select/deselect everything
  // at once.
  const [rows, setRows] = useState([]); // { file, selected, status, message }
  const [running, setRunning] = useState(false);
  const wakeLockRef = useRef(null);

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  // Keep the screen from auto-locking while a sync is running, and warn
  // before an accidental tab close/reload mid-sync. Neither of these stops
  // the browser from continuing the upload loop if the person switches to
  // another app — that's normal background-tab behavior, not something this
  // page controls — but they help the common case of the phone just sitting
  // there and the screen timing out.
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Wake Lock isn't available/allowed here — sync still proceeds fine,
        // it just won't keep the screen awake by itself.
      }
    }

    function handleVisibilityChange() {
      if (running && document.visibilityState === "visible" && !wakeLockRef.current) {
        acquireWakeLock();
      }
    }

    function handleBeforeUnload(e) {
      if (running) {
        e.preventDefault();
        e.returnValue = "";
      }
    }

    if (running) {
      acquireWakeLock();
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [running]);

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
        const data = await uploadWithRetry(file);

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
  const errorCount = rows.filter((r) => r.selected && r.status === "error").length;
  const progressPct = selectedRows.length
    ? Math.round((finishedCount / selectedRows.length) * 100)
    : 0;
  const allDone =
    !running && selectedRows.length > 0 && finishedCount === selectedRows.length;

  async function retryFailed() {
    const targets = rows
      .map((r, idx) => ({ ...r, idx }))
      .filter((r) => r.selected && r.status === "error");
    if (targets.length === 0) return;
    setRunning(true);

    for (const target of targets) {
      const { file, idx } = target;
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, status: "uploading" } : r))
      );
      try {
        const data = await uploadWithRetry(file);
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

  return (
    <>
      <p className="page-eyebrow">Bước 2</p>
      <h1 className="page-title">Chọn ảnh/video để đồng bộ</h1>
      <p className="page-sub">
        Chọn ảnh/video trên máy. File nào đã từng đồng bộ trước đó sẽ tự động được bỏ
        qua. Các file còn lại sẽ lần lượt được lưu vào tài khoản Google đang trống nhiều
        dung lượng nhất. Trong lúc đồng bộ, bạn có thể chuyển sang dùng app khác — chỉ cần
        đừng vuốt tắt tab này. Nếu lỡ bị gián đoạn giữa chừng, quay lại đây và chọn lại
        đúng những ảnh/video đó, phần đã lưu xong sẽ tự bỏ qua, chỉ tiếp tục phần còn lại.
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
              className="btn btn-ghost-paper btn-small"
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

          {allDone && errorCount === 0 && (
            <div className="banner banner-ok">
              Xong! Giờ bạn có thể tự xoá các ảnh/video này khỏi máy, và xem lại trong{" "}
              <a href="/library">Thư viện</a>.
            </div>
          )}

          {allDone && errorCount > 0 && (
            <div className="banner banner-error">
              {errorCount} file bị lỗi (thường do mất mạng lúc chuyển app) —{" "}
              <button
                className="btn btn-small"
                style={{ marginLeft: 6 }}
                onClick={retryFailed}
              >
                Thử lại {errorCount} file lỗi
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
