export interface Theme {
  name: string;
  className: string;
  variables: {
    '--bg-primary': string;
    '--bg-secondary': string;
    '--bg-tertiary': string;
    '--bg-hover': string;
    '--bg-selected': string;
    '--text-primary': string;
    '--text-secondary': string;
    '--text-muted': string;
    '--border-color': string;
    '--accent-color': string;
    '--error-color': string;
    '--success-color': string;
  };
}

export const themes: Record<string, Theme> = {
  light: {
    name: 'Light',
    className: 'theme-light',
    variables: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f8fafc',
      '--bg-tertiary': '#f1f5f9',
      '--bg-hover': '#e2e8f0',
      '--bg-selected': '#e0f2fe',
      '--text-primary': '#1e293b',
      '--text-secondary': '#475569',
      '--text-muted': '#64748b',
      '--border-color': '#e2e8f0',
      '--accent-color': '#0891b2',
      '--error-color': '#ef4444',
      '--success-color': '#14b8a6',
    },
  },
  dark: {
    name: 'Dark',
    className: 'theme-dark',
    variables: {
      '--bg-primary': '#1a1a1a',
      '--bg-secondary': '#242424',
      '--bg-tertiary': '#2e2e2e',
      '--bg-hover': '#383838',
      '--bg-selected': '#333333',
      '--text-primary': '#e5e5e5',
      '--text-secondary': '#a3a3a3',
      '--text-muted': '#737373',
      '--border-color': '#404040',
      '--accent-color': '#22d3ee',
      '--error-color': '#f87171',
      '--success-color': '#2dd4bf',
    },
  },
};

export const defaultThemeId = 'light';

export function getThemeClassName(themeId: string): string {
  const theme = themes[themeId] || themes[defaultThemeId];
  return theme.className;
}

export function getTheme(themeId: string): Theme {
  return themes[themeId] || themes[defaultThemeId];
}

export function getAllThemeIds(): string[] {
  return Object.keys(themes);
}
