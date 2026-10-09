export const $ = (id) => document.getElementById(id);

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function togglePanel(buttonId, panelId) {
  const visible = $(panelId).hidden;
  $(panelId).hidden = !visible;
  $(buttonId).setAttribute('aria-expanded', String(visible));
}

export function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = element('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const filename = (name) => name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'project';
