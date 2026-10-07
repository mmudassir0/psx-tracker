import type { MetadataRoute } from "next";

/** Makes the site installable ("Add to Home Screen"), which iOS requires for push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PSX Tracker",
    short_name: "PSX Tracker",
    description: "PSX market data for every index, a whole-market heatmap, your portfolio and alerts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
