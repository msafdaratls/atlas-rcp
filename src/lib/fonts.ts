import localFont from "next/font/local";

/**
 * Self-hosted only — never load fonts from a CDN at runtime.
 * Latin: Montserrat. Arabic UI: dedicated Arabic face (swap file for
 * true Montserrat Arabic assets when available from brand kit).
 */
export const montserrat = localFont({
  src: [
    {
      path: "../fonts/montserrat-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/montserrat-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/montserrat-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-montserrat",
  display: "swap",
  preload: true,
});

export const montserratArabic = localFont({
  src: [
    {
      path: "../fonts/arabic-ui-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/arabic-ui-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/arabic-ui-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-montserrat-arabic",
  display: "swap",
  preload: true,
});

export const ibmPlexMono = localFont({
  src: [
    {
      path: "../fonts/ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/ibm-plex-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  preload: true,
});
