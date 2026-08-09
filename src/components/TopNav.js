"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Thư viện" },
  { href: "/sync", label: "Đồng bộ" },
  { href: "/tai-khoan", label: "Tài khoản" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="topnav">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <a
            key={link.href}
            href={link.href}
            className={active ? "topnav-link is-active" : "topnav-link"}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
