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
    '--body-bg'?: string; // Optional body background for special themes
  };
}

export const themes: Record<string, Theme> = {
  'dark-modern': {
    name: 'Dark Modern',
    className: 'theme-dark-modern',
    variables: {
      '--bg-primary': '#1e1e1e',
      '--bg-secondary': '#252526',
      '--bg-tertiary': '#2d2d30',
      '--bg-hover': '#3c3c3c',
      '--bg-selected': '#094771',
      '--text-primary': '#cccccc',
      '--text-secondary': '#9d9d9d',
      '--text-muted': '#6d6d6d',
      '--border-color': '#3c3c3c',
      '--accent-color': '#007acc',
      '--error-color': '#f14c4c',
      '--success-color': '#4ec9b0',
    },
  },
  glass: {
    name: 'Glass',
    className: 'theme-glass',
    variables: {
      '--bg-primary': 'rgba(20, 20, 30, 0.7)',
      '--bg-secondary': 'rgba(30, 30, 45, 0.6)',
      '--bg-tertiary': 'rgba(40, 40, 60, 0.5)',
      '--bg-hover': 'rgba(60, 60, 90, 0.4)',
      '--bg-selected': 'rgba(0, 122, 204, 0.3)',
      '--text-primary': '#e0e0e0',
      '--text-secondary': '#b0b0b0',
      '--text-muted': '#808080',
      '--border-color': 'rgba(255, 255, 255, 0.1)',
      '--accent-color': '#5dade2',
      '--error-color': '#ff6b6b',
      '--success-color': '#51cf66',
      '--body-bg': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
  },
  bold: {
    name: 'Bold',
    className: 'theme-bold',
    variables: {
      '--bg-primary': '#0a0a0a',
      '--bg-secondary': '#1a1a1a',
      '--bg-tertiary': '#2a2a2a',
      '--bg-hover': '#3a3a3a',
      '--bg-selected': '#0066cc',
      '--text-primary': '#ffffff',
      '--text-secondary': '#cccccc',
      '--text-muted': '#999999',
      '--border-color': '#ffffff',
      '--accent-color': '#00ff88',
      '--error-color': '#ff3333',
      '--success-color': '#00ff88',
    },
  },
  minimal: {
    name: 'Minimal',
    className: 'theme-minimal',
    variables: {
      '--bg-primary': '#fafafa',
      '--bg-secondary': '#ffffff',
      '--bg-tertiary': '#f5f5f5',
      '--bg-hover': '#eeeeee',
      '--bg-selected': '#e3f2fd',
      '--text-primary': '#212121',
      '--text-secondary': '#616161',
      '--text-muted': '#9e9e9e',
      '--border-color': 'transparent',
      '--accent-color': '#2196f3',
      '--error-color': '#f44336',
      '--success-color': '#4caf50',
    },
  },
  fluid: {
    name: 'Fluid',
    className: 'theme-fluid',
    variables: {
      '--bg-primary': '#1a1a2e',
      '--bg-secondary': '#16213e',
      '--bg-tertiary': '#0f3460',
      '--bg-hover': '#1a4d7a',
      '--bg-selected': '#533483',
      '--text-primary': '#eaeaea',
      '--text-secondary': '#b8b8b8',
      '--text-muted': '#888888',
      '--border-color': '#533483',
      '--accent-color': '#e94560',
      '--error-color': '#ff6b9d',
      '--success-color': '#00d9ff',
    },
  },
  neon: {
    name: 'Neon',
    className: 'theme-neon',
    variables: {
      '--bg-primary': '#0d0d0d',
      '--bg-secondary': '#1a0d1a',
      '--bg-tertiary': '#260d26',
      '--bg-hover': '#330d33',
      '--bg-selected': '#4d004d',
      '--text-primary': '#ff00ff',
      '--text-secondary': '#cc00cc',
      '--text-muted': '#990099',
      '--border-color': '#ff00ff',
      '--accent-color': '#00ffff',
      '--error-color': '#ff0066',
      '--success-color': '#00ff66',
    },
  },
};

export const defaultThemeId = 'dark-modern';

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
