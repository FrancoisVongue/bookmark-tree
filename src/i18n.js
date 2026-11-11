// Every text the interface shows comes from _locales/<language>/messages.json.
export const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions.map(String)) || key;
