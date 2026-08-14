"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { captureVideoFrame } from "@/lib/captureVideoFrame";

// Phải khớp chính xác với makeDedupeKey() trong src/lib/library.js.
// Không dùng lastModified vì iOS Safari và một số Android trả về giá trị
// khác nhau mỗi lần chọn file — xem ghi chú trong library.js.
function dedupeKeyOf(file) {
  return `${file.name}__${file.size}`;
}

// Shows (or updates, thanks to the fixed `tag`) a real OS-level
// notification — this is what lets someone switch away to another app and
// still see how the sync is going from the notification shade, without
// needing to keep this tab in the foreground. It does not, by itself, make
// the upload loop keep running if the OS fully suspends the tab — nothing
// on the web platform can guarantee that — but as long as the tab stays
// alive in the background (the common case on Android), this keeps the
// person informed without having to reopen the page.
function notify(title, body) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag: "photo-sync-progress",
      icon: "/icon-192.png",
      silent: true,
    });
  } catch {
    // A handful of browsers expose the Notification API but don't actually
    // support the constructor (e.g. some in-app browsers) — fail quietly
    // rather than interrupting the sync over a notification.
  }
}

async function ensureNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission(); // "granted" | "denied" | "default"
  } catch {
    return "unsupported";
  }
}

// Sends the whole file to Google in ~4MB pieces, each one relayed through
// our own server (see /api/drive/upload/chunk for why: it keeps every
// browser request same-origin, so nothing here depends on whether Google's
// upload endpoint allows direct cross-origin requests from arbitrary web
// apps — a 4MB chunk also stays safely under Vercel's 4.5MB request limit).
const CHUNK_SIZE = 4 * 1024 * 1024;

async function putInChunks(sessionUrl, file) {
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);

    let data;
    let lastErr;
    // A single chunk is small and quick, so a couple of quiet retries here
    // comfortably absorb the kind of brief network blip that's common on
    // mobile, without having to restart the whole file from scratch.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/drive/upload/chunk", {
          method: "POST",
          headers: {
            "X-Session-Url": sessionUrl,
            "X-Total-Size": String(file.size),
            "X-Chunk-Start": String(offset),
            "Content-Type": "application/octet-stream",
          },
          body: chunk,
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || `Lỗi tải lên (${res.status})`);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (lastErr) throw lastErr;

    if (data.status === "complete") return data.file;
    offset = end;
  }

  throw new Error("Tải lên kết thúc nhưng Google chưa xác nhận hoàn tất");
}

// Full flow for one file: ask our server to dedupe-check + pick an account
// + open a Google resumable session (small JSON only), then send the file
// bytes in small chunks (see putInChunks above), then tell our server the
// small resulting metadata so it can be recorded.
async function syncOneFile(file) {
  const isVideo = file.type.startsWith("video/");
  // Kick this off in parallel with the init round-trip below — no reason
  // to wait on the server before starting the frame capture.
  const clientThumbnailPromise = isVideo ? captureVideoFrame(file) : Promise.resolve(null);

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

  const driveFile = await putInChunks(initData.sessionUrl, file);
  const clientThumbnail = await clientThumbnailPromise;

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
      clientThumbnail,
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
  const [notifyStatus, setNotifyStatus] = useState(null); // "granted" | "denied" | "default" | "unsupported"
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
    // Revoke any previous preview URLs before replacing the selection, so we
    // don't leak memory if the person picks files more than once.
    setRows((prev) => {
      prev.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
      return files.map((file) => ({
        file,
        selected: true,
        status: "pending",
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      }));
    });
  }

  // Clean up any outstanding preview URLs when the page unmounts.
  useEffect(() => {
    return () => {
      rows.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSelectAll(checked) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })));
  }

  function toggleOne(idx) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r))
    );
  }

  // How many files upload at the same time. 3 is a deliberate middle ground:
  // enough to keep the network busy between requests (helpful when syncing
  // many small photos), but not so many that they fight each other for the
  // phone's limited upload bandwidth (which mostly matters for big videos —
  // see the note in the UI below).
  const SYNC_CONCURRENCY = 3;

  async function runQueue(targets) {
    if (targets.length === 0) return;
    setRunning(true);

    const status = await ensureNotificationPermission();
    setNotifyStatus(status);
    const notifyEnabled = status === "granted";
    const total = targets.length;
    let completed = 0;
    let okCount = 0;
    let skipCount = 0;
    let errCount = 0;

    function pushProgress() {
      if (!notifyEnabled) return;
      const done = completed >= total;
      notify(
        done ? "Đồng bộ hoàn tất" : "Đang đồng bộ ảnh/video",
        `${completed}/${total} file — ${okCount} đã lưu, ${skipCount} bỏ qua${
          errCount ? `, ${errCount} lỗi` : ""
        }`
      );
    }
    pushProgress();

    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
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
            skipCount += 1;
          } else {
            setRows((prev) =>
              prev.map((r, i) =>
                i === idx
                  ? { ...r, status: "ok", message: `Đã lưu vào ${data.account}` }
                  : r
              )
            );
            okCount += 1;
          }
        } catch (err) {
          setRows((prev) =>
            prev.map((r, i) => (i === idx ? { ...r, status: "error", message: err.message } : r))
          );
          errCount += 1;
        }

        completed += 1;
        pushProgress();
      }
    }

    const workerCount = Math.min(SYNC_CONCURRENCY, targets.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

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
      <div className="page-head">
        <h1 className="page-title">Chọn ảnh/video để đồng bộ</h1>
        <div className="title-rule" aria-hidden="true" />
      </div>

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
                Chọn tất cả
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
                  <span className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={running}
                      onChange={() => toggleOne(idx)}
                    />
                    <span className="thumb-preview">
                      {r.previewUrl ? (
                        <img src={r.previewUrl} alt="" />
                      ) : (
                        <span className="video-glyph">▶</span>
                      )}
                    </span>
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

          {!running && selectedRows.length > 0 && finishedCount === 0 && notifyStatus === null && (
            <p className="field-hint">
              Trình duyệt sẽ hỏi quyền gửi thông báo khi bạn bấm bắt đầu — cho phép để xem
              tiến trình từ thanh thông báo khi thoát ra dùng app khác.
            </p>
          )}

          {notifyStatus === "granted" && (
            <p className="field-hint" style={{ color: "var(--teal-bright)" }}>
              ✓ Đã bật thông báo — kéo thanh thông báo xuống để xem tiến trình bất cứ lúc nào.
            </p>
          )}

          {notifyStatus === "default" && (
            <p className="field-hint">
              Bạn chưa chọn cho phép hay từ chối thông báo — bấm "Bắt đầu đồng bộ" lần nữa để
              trình duyệt hỏi lại.
            </p>
          )}
          {notifyStatus === "unsupported" && (
            <p className="field-hint">
              Trình duyệt hoặc app đang mở trang này không hỗ trợ thông báo hệ thống. Việc
              đồng bộ vẫn diễn ra bình thường, chỉ là không có thông báo nhắc tiến trình.
            </p>
          )}

          {selectedRows.length > 0 && (running || finishedCount > 0) && (
            <div className="progress-row">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="progress-label">{progressPct}%</span>
            </div>
          )}

          {allDone && errorCount === 0 && (
            <div className="banner banner-ok">
              Xong! Giờ bạn có thể tự xoá các ảnh/video này khỏi máy, và xem lại trong{" "}
              <a href="/">Thư viện</a>.
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
