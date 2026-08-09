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
                          {bytes(acc.quota.usage)} đã dùng / {bytes(acc.quota.limit)} —{" "}
                          {bytes(acc.quota.free)} trống
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
      </div>
    </>
  );
}
