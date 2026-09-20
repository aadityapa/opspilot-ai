/**
 * Where an engineer came from, so a ticket can send them back to the same queue, page, sort and
 * scroll position. The URL stays authoritative: only the hash and a scroll offset are remembered.
 */
export const rememberDeskReturn = () => {
  try { sessionStorage.setItem('opspilot:desk-return', location.hash); sessionStorage.setItem('opspilot:desk-scroll', String(window.scrollY)); } catch { /* optional */ }
};
export const deskReturnHref = () => { try { return sessionStorage.getItem('opspilot:desk-return') || '#/tickets'; } catch { return '#/tickets'; } };
export const deskReturnScroll = () => {
  try {
    if (sessionStorage.getItem('opspilot:desk-return') !== location.hash) return 0;
    const y = Number(sessionStorage.getItem('opspilot:desk-scroll') || 0);
    sessionStorage.removeItem('opspilot:desk-return');
    return y;
  } catch { return 0; }
};
