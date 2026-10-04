import { MAX_ANSWER_TEXT_LENGTH } from "../shared/answer-models";

interface DocumentPictureInPicture {
  readonly window: Window | null;
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export class PipCompanion {
  private pipWindow: Window | null = null;
  private statusElement: HTMLElement | null = null;
  private transcriptElement: HTMLElement | null = null;
  private status = "";
  private transcript = "";
  private opening = false;
  private openAttempt = 0;

  constructor(private readonly owner: Window, private readonly onVisibilityChanged: () => void) {}

  private get api(): DocumentPictureInPicture | undefined {
    return (this.owner as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;
  }

  get available(): boolean {
    return typeof this.api?.requestWindow === "function";
  }

  visible(): boolean {
    return this.pipWindow !== null && !this.pipWindow.closed && this.pipWindow.document.visibilityState === "visible";
  }

  async open(): Promise<void> {
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.focus();
      return;
    }
    const api = this.api;
    if (!api || typeof api.requestWindow !== "function") throw new Error("Document Picture-in-Picture is not available in this browser.");
    if (this.opening) throw new Error("The Gemini companion is already opening.");
    if (api.window && !api.window.closed) throw new Error("Another Picture-in-Picture window is already open. Close it before opening the Gemini companion.");
    this.opening = true;
    const attempt = ++this.openAttempt;
    try {
      // Keep the native request in the trusted click's call stack, before the first await.
      const pip = await api.requestWindow({ width: 360, height: 260 });
      if (attempt !== this.openAttempt) { pip.close(); return; }
      this.pipWindow = pip;
      const doc = pip.document;
      doc.title = "Gemini Search Bridge";
      const style = doc.createElement("style");
      style.textContent = "html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:18px;background:#F2F5FC;color:#243149;font:13px/1.6 system-ui,-apple-system,'Yu Gothic UI',Meiryo,sans-serif}h1{font-size:13px;font-weight:700;letter-spacing:.02em;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #D8E0EF}p{margin:0 0 12px;color:#415FC8;font-weight:650}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:14px 0 0;padding-top:12px;border-top:1px solid #D8E0EF;color:#243149}pre:empty{display:none}button{font:inherit;padding:6px 10px;border:1px solid #D8E0EF;border-radius:7px;background:white;color:#415FC8;cursor:pointer}button:hover{border-color:#415FC8}button:focus-visible{outline:3px solid #415FC8;outline-offset:3px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}";
      doc.head.append(style);
      const heading = doc.createElement("h1");
      heading.textContent = "Gemini Search Bridge";
      this.statusElement = doc.createElement("p");
      this.statusElement.setAttribute("role", "status");
      this.transcriptElement = doc.createElement("pre");
      this.transcriptElement.setAttribute("aria-live", "off");
      const returnButton = doc.createElement("button");
      returnButton.type = "button";
      returnButton.textContent = "Geminiに戻る";
      returnButton.addEventListener("click", () => this.owner.focus());
      doc.body.replaceChildren(heading, this.statusElement, returnButton, this.transcriptElement);
      doc.addEventListener("visibilitychange", () => {
        if (this.pipWindow === pip) this.onVisibilityChanged();
      });
      pip.addEventListener("pagehide", () => this.release(pip));
      this.update(this.status, this.transcript);
      this.onVisibilityChanged();
    } catch (error) {
      this.close();
      throw new Error(`Could not open the Gemini companion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.opening = false;
    }
  }

  private release(pip: Window): void {
    if (this.pipWindow !== pip) return;
    this.pipWindow = null;
    this.statusElement = null;
    this.transcriptElement = null;
    this.onVisibilityChanged();
  }

  close(): void {
    ++this.openAttempt;
    const pip = this.pipWindow;
    if (!pip) return;
    this.release(pip);
    if (!pip.closed) pip.close();
  }

  update(status: string, text: string): void {
    this.status = status;
    this.transcript = text.slice(0, MAX_ANSWER_TEXT_LENGTH);
    if (this.statusElement) this.statusElement.textContent = this.status;
    if (this.transcriptElement) this.transcriptElement.textContent = this.transcript;
  }
}
