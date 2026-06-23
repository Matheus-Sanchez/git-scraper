(function () {
  const THEME_KEY = 'git-scraper-theme';
  const root = document.documentElement;

  function readStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function writeStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme still works for the current page even when storage is unavailable.
    }
  }

  function normalizeTheme(value) {
    return value === 'light' ? 'light' : 'dark';
  }

  function currentTheme() {
    return normalizeTheme(root.dataset.theme || readStoredTheme());
  }

  function updateButtons(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const nextTheme = theme === 'light' ? 'dark' : 'light';
      button.textContent = nextTheme === 'light' ? 'Tema claro' : 'Tema escuro';
      button.setAttribute('aria-label', nextTheme === 'light' ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.setAttribute('aria-pressed', String(theme === 'light'));
    });
  }

  function applyTheme(theme) {
    const normalizedTheme = normalizeTheme(theme);
    root.dataset.theme = normalizedTheme;
    writeStoredTheme(normalizedTheme);
    updateButtons(normalizedTheme);
    window.dispatchEvent(new CustomEvent('git-scraper-theme-change', {
      detail: { theme: normalizedTheme },
    }));
  }

  applyTheme(currentTheme());

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  });
}());
