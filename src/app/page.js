"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyGlyph from "@/components/EmptyGlyph";

function dayLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function LibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  // Index into `items` of the photo/video currently open in the full-screen
  // viewer, or null when the viewer is closed. Because opening a file just
  // shows an overlay on top of this same page (instead of navigating to a
  // new tab/route), the grid's scroll position is never disturbed — closing
  // the viewer lands you exactly back where you were.
  const [viewerIndex, setViewerIndex] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/library");
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }

  const totals = useMemo(() => {
    const videoCount = items.filter((i) => !i.mimeType?.startsWith("image/")).length;
    return { all: items.length, image: items.length - videoCount, video: videoCount };
  }, [items]);

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
            <span className="count-badge">{dayItems.length} file</span>
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
                    {item.mimeType?.startsWith("image/") ? (
                      <img src={`/api/drive/thumbnail?id=${item.id}`} alt={item.name} loading="lazy" />
                    ) : (
                      <span className="video-glyph">▶</span>
                    )}
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
