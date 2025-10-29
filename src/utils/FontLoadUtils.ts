export const DIAGRAM_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans Pro',
  'Raleway',
  'Comic Sans MS',
  'Ubuntu',
  'Nunito',
  'Playfair Display',
  'Merriweather',
  'PT Sans',
  'Oswald',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana'
] as const;

export type DiagramFont = typeof DIAGRAM_FONTS[number];

export function loadDiagramFonts() {
  if (typeof window === 'undefined') return;
  
  if (document.getElementById('google-fonts-link')) return;
  
  const googleFonts = DIAGRAM_FONTS.slice(0, -6);
  const fontParams = googleFonts
    .map(font => `family=${font.replace(/ /g, '+')}:wght@400;700`)
    .join('&');
  
  const link = document.createElement('link');
  link.id = 'google-fonts-link';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${fontParams}&display=swap`;
  
  document.head.appendChild(link);
}