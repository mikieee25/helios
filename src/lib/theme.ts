export type ThemeMode = "dark" | "light";
export type ThemeColors = {
  background: string;
  surface: string;
  accent: string;
  text: string;
  download: string;
  upload: string;
};

export const DEFAULT_THEME_COLORS: Record<ThemeMode, ThemeColors> = {
  dark: {
    background: "#050507",
    surface: "#0d0d12",
    accent: "#4cc3f0",
    text: "#e9e9f0",
    download: "#4cc3f0",
    upload: "#a66bf0",
  },
  light: {
    background: "#ffffff",
    surface: "#f3f4f8",
    accent: "#1397cc",
    text: "#16161d",
    download: "#1397cc",
    upload: "#8a47d8",
  },
};

function normalizePalette(value: unknown, defaults: ThemeColors): ThemeColors {
  const colors = value && typeof value === "object" ? value as Partial<ThemeColors> : {};
  const color = (key: keyof ThemeColors) =>
    typeof colors[key] === "string" && /^#[\da-f]{6}$/i.test(colors[key]!)
      ? colors[key]!.toLowerCase()
      : defaults[key];
  return {
    background: color("background"),
    surface: color("surface"),
    accent: color("accent"),
    text: color("text"),
    download: color("download"),
    upload: color("upload"),
  };
}

export function normalizeThemeColors(value: unknown): Record<ThemeMode, ThemeColors> {
  const colors = value && typeof value === "object" ? value as Partial<Record<ThemeMode, unknown>> : {};
  return {
    dark: normalizePalette(colors.dark, DEFAULT_THEME_COLORS.dark),
    light: normalizePalette(colors.light, DEFAULT_THEME_COLORS.light),
  };
}

export function applyThemeColors(mode: ThemeMode, colors: ThemeColors) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.setProperty("--bg", colors.background);
  root.style.setProperty("--row", colors.surface);
  root.style.setProperty("--cy", colors.accent);
  root.style.setProperty("--tx", colors.text);
  root.style.setProperty("--download", colors.download);
  root.style.setProperty("--upload", colors.upload);
}
