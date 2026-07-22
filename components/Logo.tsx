export default function Logo({ height = 20, className = "" }: { height?: number; className?: string }) {
  const width = height * 1.5;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 90 60"
      className={className}
      aria-hidden="true"
      style={{ display: "inline-block" }}
    >
      <rect x="0" y="0" width="60" height="60" rx="16" fill="#264B5D" />
      <rect x="30" y="0" width="60" height="60" rx="16" fill="#E8963A" />
      <rect x="30" y="0" width="30" height="60" rx="16" fill="#F5A623" />
      <path
        d="M3,57 L3,16 A13,13 0 0 1 16,3 L44,3 A13,13 0 0 1 57,16 L57,57"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M33,57 L33,16 A13,13 0 0 1 46,3 L74,3 A13,13 0 0 1 87,16 L87,57"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}