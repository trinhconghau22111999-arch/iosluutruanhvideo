"use client";

import { useEffect, useState } from "react";
import EmptyGlyph from "@/components/EmptyGlyph";

function bytes(n) {
  if (n === null || n === undefined) return "Không giới hạn";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Donut chart summarizing total used vs. free space across every connected
// account. Only accounts with a numeric quota limit are counted — a Google
// Workspace account with unlimited storage would otherwise make the whole
// chart meaningless, so it's called out separately instead.
function StorageDonut({ accounts }) {
  const bounded = accounts.filter((a) => a.quota && typeof a.quota.limit === "number");
  const hasUnlimited = accounts.some((a) => a.quota && a.quota.limit === null);

  if (bounded.length === 0) return null;

  const totalLimit = bounded.reduce((s, a) => s + a.quota.limit, 0);
  const totalUsage = bounded.reduce((s, a) => s + a.quota.usage, 0);
  const totalFree = Math.max(totalLimit - totalUsage, 0);
  const usedPct = totalLimit ? (totalUsage / totalLimit) * 100 : 0;
  const r = 15.9155; // circumference of this radius circle ≈ 100, so dasharray reads as %

  return (
    <div className="card">
      <div className="card-inner">
        <div className="donut-row">
          <div className="donut-wrap">
            <svg viewBox="0 0 36 36" className="donut-svg" role="img" aria-label={`Đã dùng ${usedPct.toFixed(0)} phần trăm dung lượng`}>
              <circle cx="18" cy="18" r={r} fill="none" stroke="var(--paper-dim)" strokeWidth="3.6" />
              <circle
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke="var(--teal)"
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeDasharray={`${usedPct} ${100 - usedPct}`}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <div className="donut-center">
              <span className="donut-pct">{usedPct.toFixed(0)}%</span>
              <span className="donut-sub">đã dùng</span>
            </div>
          </div>
          <div className="donut-legend">
            <div className="donut-legend-row">
              <span className="donut-dot donut-dot-used" />
              Đã dùng: <strong>{bytes(totalUsage)}</strong>
            </div>
            <div className="donut-legend-row">
              <span className="donut-dot donut-dot-free" />
              Còn trống: <strong>{bytes(totalFree)}</strong>
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              Tổng {bytes(totalLimit)} trên {bounded.length} tài khoản
              {hasUnlimited ? " (chưa tính tài khoản không giới hạn dung lượng)" : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) {
      setNotice({ type: "ok", text: `Đã kết nối ${params.get("connected")}` });
      window.history.replaceState({}, "", "/tai-khoan");
    }
    if (params.get("error")) {
      setNotice({ type: "error", text: params.get("error") });
      window.history.replaceState({}, "", "/tai-khoan");
    }
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data.accounts || []);
    setLoading(false);
  }

  async function disconnect(email) {
    if (!confirm(`Ngắt kết nối ${email}? Ảnh đã đồng bộ vào tài khoản này vẫn còn nguyên trên Drive, chỉ là app sẽ không upload thêm vào đó nữa.`)) return;
    await fetch("/api/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    load();
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Tài khoản Google đang kết nối</h1>
        <div className="title-rule" aria-hidden="true" />
      </div>

      {notice && (
        <div className={`banner ${notice.type === "ok" ? "banner-ok" : "banner-error"}`}>
          {notice.text}
        </div>
      )}

      <div className="stack">
        {loading && <p className="field-hint">Đang tải...</p>}

        {!loading && accounts.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-glyph">
              <EmptyGlyph />
            </div>
            Chưa có tài khoản nào. Bấm nút bên dưới để bắt đầu.
          </div>
        )}

        {accounts.map((acc) => {
          const pct = acc.quota && acc.quota.limit
            ? Math.min(100, Math.round((acc.quota.usage / acc.quota.limit) * 100))
            : 0;
          return (
            <div className="card" key={acc.email}>
              <div className="card-inner row-between">
                <div className="row">
                  <div className="avatar">
                    {acc.picture ? (
                      <img src={acc.picture} alt="" />
                    ) : (
                      (acc.name || acc.email)[0]?.toUpperCase()
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{acc.name}</div>
                    <div className="meta">{acc.email}</div>
                    {acc.quota ? (
                      <>
                        <div className="meta" style={{ marginTop: 4 }}>
                          {bytes(acc.quota.usage)} đã dùng / {bytes(acc.quota.limit)}
                        </div>
                        {acc.quota.limit && (
                          <div className="quota-bar">
                            <div className="quota-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="meta">{acc.error || "..."}</div>
                    )}
                  </div>
                </div>
                <button className="btn btn-ghost-paper btn-small" onClick={() => disconnect(acc.email)}>
                  Ngắt kết nối
                </button>
              </div>
            </div>
          );
        })}

        <div className="row">
          <a className="btn" href="/api/auth/google/start">
            + Thêm tài khoản Google
          </a>
        </div>

        {!loading && accounts.length > 0 && <StorageDonut accounts={accounts} />}
      </div>
    </>
  );
}
