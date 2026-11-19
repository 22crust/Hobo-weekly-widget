export const DEFAULT_ACCENT_COLOR = "#C94A38";

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Hobonichi Red", hex: "#C94A38" },
  { name: "Terracotta", hex: "#B5654B" },
  { name: "Matcha Green", hex: "#5C7C5E" },
  { name: "Indigo Ink", hex: "#3D5A80" },
  { name: "Plum", hex: "#7A4B6E" },
  { name: "Ochre", hex: "#B6862C" },
];

export function normalizeHexColor(raw: string | null | undefined): string {
  const cleaned = (raw || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(cleaned)
    ? cleaned.toUpperCase()
    : DEFAULT_ACCENT_COLOR;
}

export function applyAccentColor(hex: string): void {
  const validHex = normalizeHexColor(hex);
  const r = parseInt(validHex.slice(1, 3), 16);
  const g = parseInt(validHex.slice(3, 5), 16);
  const b = parseInt(validHex.slice(5, 7), 16);
  const root = document.documentElement;
  root.style.setProperty("--hobo-accent-rgb", `${r} ${g} ${b}`);
  root.style.setProperty("--hobo-accent-hex", validHex);
}
