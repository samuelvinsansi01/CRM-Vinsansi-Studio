import { tokens } from '../tokens';

const setVariables = (prefix: string, values: Record<string, string>) => {
  Object.entries(values).forEach(([name, value]) => {
    document.documentElement.style.setProperty(`--${prefix}-${name}`, value);
  });
};

export const applyThemeVariables = () => {
  setVariables('color', tokens.color);
  setVariables('radius', tokens.radius);
  setVariables('space', tokens.space);
  setVariables('font', tokens.font);

  const aliases: Record<string, string> = {
    '--font-heading': tokens.font.heading,
    '--font-body': tokens.font.body,
    '--app-bg': tokens.color['pure-black'],
    '--app-text': tokens.color['pure-white'],
    '--app-muted': tokens.color['neutral-300'],
    '--app-subtle': tokens.color['neutral-400'],
    '--surface-canvas': tokens.color['neutral-950'],
    '--surface-card': tokens.color['surface-900'],
    '--surface-raised': tokens.color['surface-800'],
    '--surface-soft': tokens.color['surface-700'],
    '--border-muted': tokens.color['surface-800'],
    '--action-primary': tokens.color['primary-950-main'],
    '--action-primary-hover': tokens.color['primary-900'],
    '--action-active': tokens.color['primary-500'],
    '--action-success': tokens.color['feedback-success-500'],
    '--action-warning': tokens.color['feedback-warning-500'],
    '--action-danger': tokens.color['feedback-error-500'],
  };

  Object.entries(aliases).forEach(([name, value]) => {
    document.documentElement.style.setProperty(name, value);
  });
};
