import "./globals.css";

export const metadata = {
  title: "Ký Sự — Đồng bộ ảnh & video lên nhiều Drive",
  description: "Đồng bộ ảnh/video từ điện thoại lên nhiều tài khoản Google Drive, xem lại như một cuốn ký sự.",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#1c1917",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <a href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                ☰
              </span>
              Ký Sự
            </a>
            <nav className="topnav">
              <a href="/">Tài khoản</a>
              <a href="/sync">Đồng bộ</a>
              <a href="/library">Thư viện</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
