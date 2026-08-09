"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const ORDER = ["/", "/sync", "/tai-khoan"];
const SWIPE_THRESHOLD = 60; // px — how far a swipe must travel to count
const DIRECTION_RATIO = 1.4; // swipe must be this much more horizontal than vertical

export default function SwipeNav({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const touchStart = useRef(null);

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return; // too vertical — was a scroll

    const currentIndex = ORDER.indexOf(pathname);
    if (currentIndex === -1) return;

    // Swiping left (finger drags right-to-left) moves forward through the
    // tab order; swiping right moves back — the same feel as swiping
    // between pages in a gallery.
    const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= ORDER.length) return;

    router.push(ORDER[nextIndex]);
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {children}
    </div>
  );
}
