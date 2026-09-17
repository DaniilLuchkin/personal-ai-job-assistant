export const uid = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
