const P: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V20H4z', down: 'M12 5v14M6 13l6 6 6-6', up: 'M12 19V5M6 11l6-6 6 6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  doc: 'M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h6M9 13h6',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  video: 'M8 5l11 7-11 7z', bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  chev: 'M9 6l6 6-6 6', pause: 'M9 6v12M15 6v12', check: 'M5 12.5l4.5 4.5L19 7',
  min: 'M5 12h14', max: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  x: 'M6 6l12 12M18 6 6 18', dots: 'M6 12h.01M10 12h.01',
}
export const Ic = ({ n, className = '' }: { n: string; className?: string }) => (
  <svg className={`i ${className}`} viewBox="0 0 24 24"><path d={P[n]} /></svg>
)
