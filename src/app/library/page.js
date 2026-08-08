"use client";

import { useEffect, useMemo, useState } from "react";

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
    setItems((prev) => prev.filter((i) => i.id !== item.id));
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

  return (
    <>
      <p className="page-eyebrow">Bước 3</p>
      <h1 className="page-title">Thư viện đã đồng bộ</h1>
      <p className="page-sub">
        Toàn bộ ảnh/video đã đồng bộ từ mọi tài khoản Google, xếp theo ngày đồng bộ, mới nhất
        lên trước.
      </p>

      {loading && <p className="field-hint">Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-glyph" aria-hidden="true">◇ ◇ ◇</div>
          Chưa có file nào. Vào <a href="/sync">Đồng bộ</a> để bắt đầu.
        </div>
      )}

      {groups.map(([dayKey, dayItems]) => (
        <div className="day-group" key={dayKey}>
          <div className="day-heading">
            {dayLabel(dayItems[0].syncedAt)} · {dayItems.length} file
          </div>
          <div className="grid">
            {dayItems.map((item) => (
              <div className="tile" key={item.id}>
                <div className="tile-media">
                  {item.mimeType?.startsWith("image/") ? (
                    <img src={`/api/drive/thumbnail?id=${item.id}`} alt={item.name} loading="lazy" />
                  ) : (
                    <span className="video-glyph">▶</span>
                  )}
                </div>
                <div className="tile-body">
                  <div className="tile-name" title={item.name}>
                    {item.name}
                  </div>
                  <div className="meta" style={{ color: "var(--text-muted)" }}>
                    {item.accountEmail}
                  </div>
                  <div className="tile-actions">
                    <a href={item.driveLink} target="_blank" rel="noreferrer">
                      Xem
                    </a>
                    <button disabled={busyId === item.id} onClick={() => handleShare(item)}>
                      {busyId === item.id ? "Đang tải..." : "Chia sẻ"}
                    </button>
                    <button disabled={busyId === item.id} onClick={() => handleDelete(item)}>
                      Xoá
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
