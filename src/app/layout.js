import "./globals.css";
import TopNav from "@/components/TopNav";

export const metadata = {
  title: "Ký Sự — Đồng bộ ảnh & video lên nhiều Drive",
  description: "Đồng bộ ảnh/video từ điện thoại lên nhiều tài khoản Google Drive, xem lại như một cuốn ký sự.",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#14120d",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <TopNav />
            <div className="sprocket-rail" aria-hidden="true" />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
