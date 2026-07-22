export default function Logo({ height = 20, className = "" }: { height?: number; className?: string }) {
  const width = height * 1.5; // matches the glyph's 90:60 (3:2) bounding box

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 90 60"
      className={className}
      aria-hidden="true"
      style={{ display: "inline-block" }}
    >
      <rect x="0" y="0" width="60" height="60" rx="16" fill="#2B5F5C" fillOpacity="0.85" />
      <rect x="30" y="0" width="60" height="60" rx="16" fill="#E8963A" fillOpacity="0.85" />
      <path
        d="M3,57 L3,16 A13,13 0 0 1 16,3 L44,3 A13,13 0 0 1 57,16 L57,57"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.4"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M33,57 L33,16 A13,13 0 0 1 46,3 L74,3 A13,13 0 0 1 87,16 L87,57"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.4"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
