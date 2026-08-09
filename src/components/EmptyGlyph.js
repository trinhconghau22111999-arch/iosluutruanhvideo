export default function EmptyGlyph() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      style={{ color: "var(--amber)" }}
    >
      <rect
        x="7"
        y="13"
        width="27"
        height="21"
        rx="2.5"
        transform="rotate(-7 7 13)"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <rect
        x="13"
        y="15"
        width="27"
        height="21"
        rx="2.5"
        transform="rotate(5 13 15)"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="24.5" cy="25.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
