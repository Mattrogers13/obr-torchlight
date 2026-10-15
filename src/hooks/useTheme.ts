import { useState, useEffect } from 'react';
import { themes, ThemeId, ColorMode } from '../themes';
import { readLocal, writeLocal } from '../storage';

const THEME_STORAGE_KEY = 'torchlight-theme';

export const useTheme = (colorMode: ColorMode) => {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    // A theme that was renamed or removed would otherwise crash on load.
    const stored = readLocal(THEME_STORAGE_KEY);
    return stored && stored in themes ? (stored as ThemeId) : 'dark-fantasy';
  });

  useEffect(() => {
    const theme = themes[themeId];
    const colors = colorMode === 'dark' ? theme.dark : theme.light;

    const root = document.documentElement;

    root.style.setProperty('--color-bg', colors.bg);
    root.style.setProperty('--color-card', colors.card);
    root.style.setProperty('--color-text', colors.text);
    root.style.setProperty('--color-text-secondary', colors.textSecondary);
    root.style.setProperty('--color-primary', colors.primary);
    root.style.setProperty('--color-primary-hover', colors.primaryHover);
    root.style.setProperty('--color-secondary', colors.secondary);
    root.style.setProperty('--color-secondary-hover', colors.secondaryHover);
    root.style.setProperty('--color-accent', colors.accent);
    root.style.setProperty('--color-success', colors.success);
    root.style.setProperty('--color-success-hover', colors.successHover);
    root.style.setProperty('--color-danger', colors.danger);
    root.style.setProperty('--color-danger-hover', colors.dangerHover);
    root.style.setProperty('--color-border', colors.border);
    root.style.setProperty('--color-border-hover', colors.borderHover);
  }, [themeId, colorMode]);

  const changeTheme = (newTheme: ThemeId) => {
    setThemeId(newTheme);
    writeLocal(THEME_STORAGE_KEY, newTheme);
  };

  return { themeId, changeTheme };
};
