import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerDownload } from "./downloadAction";

describe("triggerDownload", () => {
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  const appendChild = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    anchor.href = "";
    anchor.download = "";
    anchor.rel = "";
    anchor.click.mockClear();
    anchor.remove.mockClear();
    appendChild.mockClear();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves an already prepared blob instead of starting another remote request", () => {
    const requestDownload = vi.fn();

    triggerDownload("blob:ready-pdf", "A paper", requestDownload);

    expect(requestDownload).not.toHaveBeenCalled();
    expect(anchor.href).toBe("blob:ready-pdf");
    expect(anchor.download).toBe("A paper.pdf");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("starts a request only when no local PDF is ready", () => {
    const requestDownload = vi.fn();

    triggerDownload(undefined, "A paper", requestDownload);

    expect(requestDownload).toHaveBeenCalledOnce();
    expect(anchor.click).not.toHaveBeenCalled();
  });
});
