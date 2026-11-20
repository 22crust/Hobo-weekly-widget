import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.png", "icon-256.png"],
      manifest: {
        name: "Hobo weekly",
        short_name: "Hobo weekly",
        description: "Hobonichi-inspired offline-first planner synced with GitHub",
        theme_color: "#F7F4EB",
        background_color: "#F7F4EB",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "icon-256.png",
            sizes: "256x256",
            type: "image/png",
          },
          {
            src: "icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
