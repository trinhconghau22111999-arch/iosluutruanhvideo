"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function dedupeKeyOf(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

// Asks Google how many bytes of a resumable session it has actually
// received so far, so a dropped connection (very common mid-video, on
// mobile, while switching apps) can resume from where it left off instead
// of restarting the whole upload.
async function queryUploadOffset(sessionUrl, totalSize) {
  try {
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${totalSize}` },
    });
    if (res.status === 308) {
      const range = res.headers.get("Range"); // e.g. "bytes=0-1048575"
      if (!range) return 0;
      const match = range.match(/bytes=0-(\d+)/);
      return match ? parseInt(match[1], 10) + 1 : 0;
    }
    if (res.ok) {
      // Google actually already has the whole file — the earlier PUT
      // succeeded but the response never reached us.
      return await res.json();
    }
  } catch {
    // Network still down — caller will surface the original error.
  }
  return null;
}

async function putToGoogle(sessionUrl, file) {
  try {
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes 0-${file.size - 1}/${file.size}` },
      body: file,
    });
    if (res.ok) return await res.json();
    throw new Error(`Google trả lỗi ${res.status}`);
  } catch (err) {
    // Try once to pick up from wherever Google actually left off, rather
    // than giving up or re-sending bytes it already has.
    const offsetResult = await queryUploadOffset(sessionUrl, file.size);
    if (offsetResult === null) throw err;
    if (typeof offsetResult === "object") return offsetResult; // was already complete

    const remaining = file.slice(offsetResult);
    const res2 = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${offsetResult}-${file.size - 1}/${file.size}`,
      },
      body: remaining,
    });
    if (!res2.ok) throw new Error(`Google trả lỗi ${res2.status} khi tiếp tục tải lên`);
    return await res2.json();
  }
}

// Full flow for one file: ask our server to dedupe-check + pick an account
// + open a Google resumable session (small JSON only), then PUT the actual
// bytes straight from the browser to Google (bypassing our server and its
// 4.5MB body limit entirely — this is what makes large videos work), then
// tell our server the small resulting metadata so it can be recorded.
async function syncOneFile(file) {
  const initRes = await fetch("/api/drive/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      mimeType: file.type,
    }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || "Lỗi không rõ");
  if (initData.skipped) return initData;

  const driveFile = await putToGoogle(initData.sessionUrl, file);

  const completeRes = await fetch("/api/drive/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dedupeKey: initData.dedupeKey,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      lastModified: file.lastModified,
      accountEmail: initData.account,
      driveFileId: driveFile.id,
      driveLink: driveFile.webViewLink,
      thumbnailLink: driveFile.thumbnailLink,
    }),
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error(err.error || "Đã lưu lên Drive nhưng không ghi được vào thư viện");
  }

  return { ok: true, account: initData.account };
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

  async function runQueue(targets) {
    if (targets.length === 0) return;
    setRunning(true);

    for (const target of targets) {
      const { file, idx } = target;
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, status: "uploading" } : r))
      );

      try {
        const data = await syncOneFile(file);

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

  function startSync() {
    const targets = rows
      .map((r, idx) => ({ ...r, idx }))
      .filter((r) => r.selected);
    runQueue(targets);
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

  function retryFailed() {
    const targets = rows
      .map((r, idx) => ({ ...r, idx }))
      .filter((r) => r.selected && r.status === "error");
    runQueue(targets);
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
