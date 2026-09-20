import type { ReactNode } from 'react';

/** Stroke icon set. One size, one weight, one style — consistency is the brand. */
const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  ticket: <><path d="M4 5h16v4a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4z" /><path d="M9 9h6M9 13h6" /></>,
  board: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></>,
  inbox: <><path d="M4 4h16v12H4z" /><path d="M4 12h5l1 2h4l1-2h5" /><path d="M8 20h8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  checks: <><path d="m3 12 4 4 6-8" /><path d="m11 16 2 2 8-10" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h7M8 11h7" /></>,
  laptop: <><path d="M4 5h16v11H4z" /><path d="M2 19h20" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  building: <><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" /><path d="M8 7h2M8 11h2M8 15h2M12 7h1M12 11h1M12 15h1" /><path d="M2 21h20" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  reports: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 13h6M9 17h6" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  shield: <><path d="M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 4 2 5 2 5H4s2-1 2-5" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  spark: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  arrowLeft: <path d="M19 12H5m5 5-5-5 5-5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  paperclip: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />,
  message: <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M15 8l2 2M18 5l2 2" /></>,
  wifi: <><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" /></>,
  cloud: <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4 4 0 0 1 0 9z" />,
  printer: <><path d="M6 9V3h12v6M6 18H3v-7h18v7h-3M6 14h12v7H6z" /></>,
  wrench: <path d="M14 4a5 5 0 0 0 6 6l-9 9a2 2 0 0 1-3-3l9-9a5 5 0 0 0-3-3z" />,
  mail: <><path d="M3 6h18v12H3z" /><path d="M3 7l9 6 9-6" /></>,
  phone: <><path d="M7 3h10v18H7z" /><path d="M11 18h2" /></>,
  card: <><path d="M2 6h20v12H2z" /><path d="M2 10h20M6 15h4" /></>,
  calendar: <><path d="M3 5h18v16H3z" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  bug: <><path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z" /><path d="M3 13h5M16 13h5M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2" /></>,
  rocket: <><path d="M12 3c3 2 5 6 5 10l-2 3h-6l-2-3c0-4 2-8 5-10z" /><path d="M9 16l-3 4M15 16l3 4M12 9h.01" /></>,
  chair: <><path d="M6 3h12v9H6z" /><path d="M4 12h16v3H4zM6 15v6M18 15v6" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 9v5M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  edit: <><path d="M4 20h4l10-10-4-4L4 16z" /><path d="m12.5 7.5 4 4" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  link: <><path d="M10 13a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 11a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>,
  thumbUp: <><path d="M7 21V10l4-7a2 2 0 0 1 3 1.8V9h4.2a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 20H7z" /><path d="M7 10H4v11h3" /></>,
  thumbDown: <><path d="M17 3v11l-4 7a2 2 0 0 1-3-1.8V15H5.8a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 7 4h10z" /><path d="M17 14h3V3h-3" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5M3 17l9 5 9-5" /></>,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><path d="M7 8h.01" /></>,
  flag: <path d="M5 21V4h11l-1 4 1 4H5" />,
  logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {PATHS[name] ?? PATHS.box}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);

/** The OpsPilot mark: a heading needle inside a rounded square. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#2457e6" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.2" opacity="0.9" />
      <path d="M16 8.5 19 16l-3 7.5-3-7.5z" fill="#fff" />
      <circle cx="16" cy="16" r="1.6" fill="#2457e6" />
    </svg>
  );
}
