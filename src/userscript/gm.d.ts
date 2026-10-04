declare function GM_getValue<T>(key: string, fallback: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_deleteValue(key: string): void;
declare function GM_addValueChangeListener(
  key: string,
  listener: (key: string, previous: unknown, value: unknown, remote: boolean) => void,
): number;
declare function GM_getTab(callback: (tab: Record<string, unknown>) => void): void;
declare function GM_saveTab(tab: Record<string, unknown>): void;
declare function GM_getTabs(callback: (tabs: Record<string, Record<string, unknown>>) => void): void;
