import { darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

export function createAppLightTheme(): ReturnType<typeof lightTheme> {
  return lightTheme({
    accentColor: "hsl(210 40% 96.1%)",
    accentColorForeground: "hsl(215.4 16.3% 20%)",
    borderRadius: "medium",
  });
}

export function createAppDarkTheme(): ReturnType<typeof darkTheme> {
  return darkTheme({
    accentColor: "hsl(217.2 32.6% 17.5%)",
    accentColorForeground: "hsl(210 40% 98%)",
    borderRadius: "medium",
  });
}
