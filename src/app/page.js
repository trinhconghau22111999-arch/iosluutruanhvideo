"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyGlyph from "@/components/EmptyGlyph";
import { captureVideoFrame } from "@/lib/captureVideoFrame";

function dayLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Grid thumbnail for one tile. Tries Drive's small generated thumbnail for
// any file type — images and videos alike — and falls back to a plain play
// glyph if none is available yet (e.g. Drive hasn't finished generating one
// for a just-uploaded video). Videos also get a small play badge overlaid
// on top of their frame preview so they stay visually distinct from photos.
function TileThumb({ item }) {
  const [failed, setFailed] = useState(false);
  const isVideo = !item.mimeType?.startsWith("image/");

  if (failed) {
    return <span className="video-glyph">▶</span>;
  }

  return (
    <>
      <img
        src={`/api/drive/thumbnail?id=${item.id}`}
        alt={item.name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {isVideo && (
        <span className="tile-play-badge" aria-hidden="true">
          ▶
        </span>
      )}
    </>
  );
}

export default function LibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [downloading, setDownloading] = useState(false); // trạng thái tải về toàn bộ
  const [downloadProgress, setDownloadProgress] = useState(null); // { done, total, failed }
  // Index into `items` of the photo/video currently open in the full-screen
  // viewer, or null when the viewer is closed. Because opening a file just
  // shows an overlay on top of this same page (instead of navigating to a
  // new tab/route), the grid's scroll position is never disturbed — closing
  // the viewer lands you exactly back where you were.
  const [viewerIndex, setViewerIndex] = useState(null);

  const backfillingRef = useRef(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/library");
    const data = await res.json();
    const nextItems = data.items || [];
    setItems(nextItems);
    setLoading(false);
    // Tell the service worker the full set of still-valid ids so it can
    // drop any cached thumbnails for files that were deleted elsewhere
    // (a different tab, another session) since the cache was last synced.
    navigator.serviceWorker?.controller?.postMessage({
      type: "SYNC_IDS",
      ids: nextItems.map((i) => i.id),
    });

    // Videos synced before the client-side frame capture existed (or ones
    // Drive itself never generated a thumbnailLink for) still show just
    // the plain play glyph — quietly backfill those in the background,
    // no action needed from the person.
    const missing = nextItems.filter(
      (i) => !i.mimeType?.startsWith("image/") && !i.thumbnailLink && !i.clientThumbnail
    );
    if (missing.length > 0 && !backfillingRef.current) backfillThumbnails(missing);
  }

  const totals = useMemo(() => {
    const videoCount = items.filter((i) => !i.mimeType?.startsWith("image/")).length;
    return { all: items.length, image: items.length - videoCount, video: videoCount };
  }, [items]);

  const [backfillProgress, setBackfillProgress] = useState(null); // { done, total } | null

  async function backfillThumbnails(targets) {
    backfillingRef.current = true;
    setBackfillProgress({ done: 0, total: targets.length });

    const queue = [...targets];
    const CONCURRENCY = 2; // a couple in parallel, but full videos are heavy — don't overdo it

    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        try {
          const res = await fetch(`/api/drive/download?id=${item.id}`);
          if (!res.ok) throw new Error("download failed");
          const blob = await res.blob();
          const clientThumbnail = await captureVideoFrame(blob);
          if (!clientThumbnail) throw new Error("capture failed");

          const saveRes = await fetch("/api/drive/thumbnail/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, clientThumbnail }),
          });
          if (!saveRes.ok) throw new Error("save failed");

          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, clientThumbnail } : i)));
        } catch {
          // This one file couldn't be backfilled (bad codec, network blip,
          // etc.) — just move on, it'll show the play glyph as before and
          // get tried again next time the library loads.
        }
        setBackfillProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    backfillingRef.current = false;
    setBackfillProgress(null);
  }

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const key = new Date(item.syncedAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries()); // items already sorted desc by syncedAt from API
  }, [items]);

  async function handleDelete(item) {
    if (!confirm(`Xoá "${item.name}" khỏi Google Drive (${item.accountEmail}) và khỏi thư viện?`))
      return;
    setBusyId(item.id);
    await fetch("/api/drive/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    navigator.serviceWorker?.controller?.postMessage({ type: "DELETE_THUMB", id: item.id });
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== item.id);
      // If the deleted file was open in the viewer, step to whatever is now
      // at the same index (the next photo) or close the viewer if that was
      // the last one.
      setViewerIndex((vi) => {
        if (vi === null) return null;
        if (next.length === 0) return null;
        return Math.min(vi, next.length - 1);
      });
      return next;
    });
    setBusyId(null);
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleShare(item) {
    setBusyId(item.id);
    try {
      // Pull the actual bytes down from Drive so we can hand the OS a real
      // File — this is what makes Zalo/Facebook/Messenger receive the photo
      // or video itself, exactly like sharing from the phone's own gallery,
      // instead of a Drive link.
      const res = await fetch(`/api/drive/download?id=${item.id}`);
      if (!res.ok) throw new Error("Không tải được file từ Drive");
      const blob = await res.blob();
      const file = new File([blob], item.name, { type: item.mimeType || blob.type });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: item.name });
      } else {
        // Trình duyệt (thường là máy tính, hoặc Safari/Chrome quá cũ) không hỗ
        // trợ chia sẻ file trực tiếp — tải file về để người dùng tự đính kèm
        // trong Zalo/Facebook.
        triggerDownload(blob, item.name);
        alert("Trình duyệt này chưa hỗ trợ chia sẻ trực tiếp. Đã tải file về máy, bạn có thể tự đính kèm trong Zalo/Facebook.");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        // AbortError = người dùng tự đóng hộp thoại chia sẻ, không phải lỗi.
        alert("Không chia sẻ được: " + err.message);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadAll() {
    if (items.length === 0) return;
    if (!confirm(`Tải về toàn bộ ${items.length} file (${totals.image} ảnh + ${totals.video} video)?`))
      return;

    setDownloading(true);
    setDownloadProgress({ done: 0, total: items.length, failed: 0 });

    // Tải lần lượt từng file để tránh nghẽn băng thông
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      try {
        const res = await fetch(`/api/drive/download?id=${item.id}`);
        if (!res.ok) throw new Error("Tải thất bại");
        const blob = await res.blob();
        triggerDownload(blob, item.name);
        setDownloadProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      } catch {
        setDownloadProgress((p) => p ? { ...p, done: p.done + 1, failed: p.failed + 1 } : p);
      }
      // Nghỉ 300ms giữa các lần tải để trình duyệt không chặn download popup
      if (idx < items.length - 1) await new Promise((r) => setTimeout(r, 300));
    }

    setDownloading(false);
    const final = downloadProgress;
    setDownloadProgress(null);
    if (final && final.failed > 0) {
      alert(`Đã tải ${final.total - final.failed}/${final.total} file. ${final.failed} file bị lỗi.`);
    }
  }

  const closeViewer = useCallback(() => setViewerIndex(null), []);
  const showPrev = useCallback(() => {
    setViewerIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  }, []);
  const showNext = useCallback(() => {
    setViewerIndex((i) => (i === null ? null : Math.min(items.length - 1, i + 1)));
  }, [items.length]);

  // Keyboard support for anyone viewing on a laptop/desktop browser.
  useEffect(() => {
    if (viewerIndex === null) return;
    function onKeyDown(e) {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
    window.addEventListener("keydown", onKeyDown);
    // Lock background scroll while the viewer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [viewerIndex, closeViewer, showPrev, showNext]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Thư viện</h1>
        <div className="title-rule" aria-hidden="true" />
        {!loading && totals.all > 0 && (
          <p className="page-count">
            {totals.all} file · {totals.image} ảnh · {totals.video} video
          </p>
        )}
      </div>

      {backfillProgress && (
        <p className="field-hint" style={{ marginBottom: 16 }}>
          Đang âm thầm tạo ảnh xem trước cho video cũ: {backfillProgress.done}/
          {backfillProgress.total}...
        </p>
      )}

      {loading && <p className="field-hint">Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-glyph">
            <EmptyGlyph />
          </div>
          Chưa có file nào. Vào <a href="/sync">Đồng bộ</a> để bắt đầu.
        </div>
      )}

      {groups.map(([dayKey, dayItems]) => (
        <div className="day-group" key={dayKey}>
          <div className="day-heading">
            <span>{dayLabel(dayItems[0].syncedAt)}</span>
          </div>
          <div className="grid">
            {dayItems.map((item) => {
              const flatIndex = items.findIndex((i) => i.id === item.id);
              return (
                <div className="tile" key={item.id}>
                  <button
                    type="button"
                    className="tile-media"
                    onClick={() => setViewerIndex(flatIndex)}
                    aria-label={`Xem ${item.name}`}
                  >
                    <TileThumb item={item} />
                  </button>
                  <div className="tile-body">
                    <div className="tile-name" title={item.name}>
                      {item.name}
                    </div>
                    <div className="meta" style={{ color: "var(--text-muted)" }}>
                      {item.accountEmail}
                    </div>
                    <div className="tile-actions">
                      <button disabled={busyId === item.id} onClick={() => handleShare(item)}>
                        {busyId === item.id ? "Đang tải..." : "Chia sẻ"}
                      </button>
                      <button disabled={busyId === item.id} onClick={() => handleDelete(item)}>
                        Xoá
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Nút tải về toàn bộ — chỉ hiện khi có ít nhất 1 file */}
      {!loading && items.length > 0 && (
        <div className="download-all-section">
          {downloadProgress && (
            <p className="field-hint" style={{ marginBottom: 12, textAlign: "center" }}>
              Đang tải… {downloadProgress.done}/{downloadProgress.total} file
              {downloadProgress.failed > 0 && ` (${downloadProgress.failed} lỗi)`}
            </p>
          )}
          <button
            className="btn btn-teal download-all-btn"
            disabled={downloading}
            onClick={handleDownloadAll}
          >
            {downloading
              ? `Đang tải ${downloadProgress?.done ?? 0}/${downloadProgress?.total ?? items.length}…`
              : `⬇ Tải về toàn bộ (${items.length} file)`}
          </button>
          <p className="field-hint" style={{ marginTop: 8, textAlign: "center" }}>
            Tải lần lượt từng file về máy. Video lớn có thể mất vài giây mỗi file.
          </p>
        </div>
      )}

      {viewerIndex !== null && items[viewerIndex] && (
        <Lightbox
          item={items[viewerIndex]}
          hasPrev={viewerIndex > 0}
          hasNext={viewerIndex < items.length - 1}
          busy={busyId === items[viewerIndex].id}
          onClose={closeViewer}
          onPrev={showPrev}
          onNext={showNext}
          onShare={() => handleShare(items[viewerIndex])}
          onDelete={() => handleDelete(items[viewerIndex])}
        />
      )}
    </>
  );
}

function Lightbox({ item, hasPrev, hasNext, busy, onClose, onPrev, onNext, onShare, onDelete }) {
  const touchStart = useRef(null);

  function handleTouchStart(e) {
    // Stop this touch from also reaching the app-wide swipe-between-tabs
    // handler in the layout — inside the viewer, a swipe should only ever
    // move between photos, never switch pages.
    e.stopPropagation();
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchMove(e) {
    e.stopPropagation();
  }

  function handleTouchEnd(e) {
    e.stopPropagation();
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly vertical — ignore

    if (dx < 0 && hasNext) onNext();
    if (dx > 0 && hasPrev) onPrev();
  }

  return (
    <div
      className="lightbox"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="lightbox-top">
        <span className="lightbox-name">{item.name}</span>
        <button className="lightbox-icon-btn" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>

      <div className="lightbox-stage">
        {hasPrev && (
          <button className="lightbox-nav lightbox-nav-prev" onClick={onPrev} aria-label="Ảnh trước">
            ‹
          </button>
        )}

        {item.mimeType?.startsWith("image/") ? (
          <img className="lightbox-media" src={`/api/drive/view?id=${item.id}`} alt={item.name} />
        ) : (
          <video
            className="lightbox-media"
            src={`/api/drive/view?id=${item.id}`}
            controls
            autoPlay
            playsInline
            preload="metadata"
            webkit-playsinline="true"
          />
        )}

        {hasNext && (
          <button className="lightbox-nav lightbox-nav-next" onClick={onNext} aria-label="Ảnh sau">
            ›
          </button>
        )}
      </div>

      <div className="lightbox-bottom">
        <span className="meta" style={{ color: "var(--text-muted)" }}>
          {item.accountEmail}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={onShare}>
            {busy ? "Đang tải..." : "Chia sẻ"}
          </button>
          <button className="btn btn-danger btn-small" disabled={busy} onClick={onDelete}>
            Xoá
          </button>
        </div>
      </div>
    </div>
  );
}
