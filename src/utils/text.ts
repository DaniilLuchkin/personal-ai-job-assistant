export const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
export const normalizeKey = (value: string) => normalizeText(value).toLowerCase().replace(/https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const splitLines = (value: string) => value.split(/\n|•|\u2022/).map(normalizeText).filter(Boolean);
export const truncate = (value: string, max = 12000) => value.length > max ? `${value.slice(0, max)}…` : value;
