import colorsRaw from './raw/Colors.json';
import radiusRaw from './raw/Corner Radius.json';
import spacingRaw from './raw/Spacings.json';
import fontRaw from './raw/Font-Family.json';

type ModeValue = string | number | { r: number; g: number; b: number; a?: number };
type RawVariable = {
  name: string;
  resolvedValuesByMode: Record<string, { resolvedValue: ModeValue }>;
};
type RawCollection = {
  name: string;
  variables: RawVariable[];
};

const collections = {
  color: colorsRaw as RawCollection,
  radius: radiusRaw as RawCollection,
  space: spacingRaw as RawCollection,
  font: fontRaw as RawCollection,
};

const normalize = (name: string) =>
  name
    .replace(/\(Main\)/gi, 'main')
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/[()]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/--+/g, '-')
    .toLowerCase();

const firstResolvedValue = (variable: RawVariable) =>
  Object.values(variable.resolvedValuesByMode)[0]?.resolvedValue;

const toCssColor = (value: ModeValue) => {
  if (typeof value !== 'object') {
    return String(value);
  }

  const r = Math.round(value.r * 255);
  const g = Math.round(value.g * 255);
  const b = Math.round(value.b * 255);
  const a = value.a ?? 1;

  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const numberValue = (value: ModeValue) => (typeof value === 'number' ? `${value}px` : String(value));

const buildTokenMap = (collection: RawCollection, formatter: (value: ModeValue) => string) =>
  collection.variables.reduce<Record<string, string>>((acc, variable) => {
    acc[normalize(variable.name)] = formatter(firstResolvedValue(variable));
    return acc;
  }, {});

export const tokens = {
  color: buildTokenMap(collections.color, toCssColor),
  radius: buildTokenMap(collections.radius, numberValue),
  space: buildTokenMap(collections.space, numberValue),
  font: buildTokenMap(collections.font, String),
};

export const tokenVarName = {
  color: (name: string) => `--color-${normalize(name)}`,
  radius: (name: string) => `--radius-${normalize(name)}`,
  space: (name: string) => `--space-${normalize(name)}`,
  font: (name: string) => `--font-${normalize(name)}`,
};

export const tokenVar = {
  color: (name: string) => `var(${tokenVarName.color(name)})`,
  radius: (name: string) => `var(${tokenVarName.radius(name)})`,
  space: (name: string) => `var(${tokenVarName.space(name)})`,
  font: (name: string) => `var(${tokenVarName.font(name)})`,
};

export type TokenGroup = keyof typeof tokens;
