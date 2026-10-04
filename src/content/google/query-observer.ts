const GOOGLE_SEARCH_HOSTS = new Set(["www.google.com", "www.google.co.jp"]);
const MAX_QUERY_LENGTH = 4_096;
export const GOOGLE_QUERY_DEBOUNCE_MS = 600;

export function isSupportedGoogleSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      GOOGLE_SEARCH_HOSTS.has(parsed.hostname) &&
      parsed.pathname === "/search"
    );
  } catch {
    return false;
  }
}

export function readGoogleQuery(url = location.href): string | null {
  if (!isSupportedGoogleSearchUrl(url)) {
    return null;
  }

  const query = new URL(url).searchParams.get("q")?.trim();
  return query ? query.slice(0, MAX_QUERY_LENGTH) : null;
}

export function observeGoogleQuery(
  onChange: (query: string | null, url: string) => void,
  debounceMs = GOOGLE_QUERY_DEBOUNCE_MS,
): () => void {
  let lastUrl = location.href;
  let timerId: number | undefined;

  const checkUrl = (): void => {
    if (location.href === lastUrl) {
      return;
    }

    lastUrl = location.href;
    onChange(readGoogleQuery(lastUrl), lastUrl);
  };

  const scheduleCheck = (): void => {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }

    timerId = window.setTimeout(checkUrl, debounceMs);
  };

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleCheck);
  window.addEventListener("hashchange", scheduleCheck);

  return () => {
    observer.disconnect();
    window.removeEventListener("popstate", scheduleCheck);
    window.removeEventListener("hashchange", scheduleCheck);

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }
  };
}
