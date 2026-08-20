import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchScholarlyText: vi.fn() }));

vi.mock("./scholarlyFetch", () => ({ fetchScholarlyText: mocks.fetchScholarlyText }));

import { buildChinesePlatformTargets, checkChinesePlatforms, classifyPlatformIndexHtml } from "./chinesePlatformService";

describe("Chinese platform discovery", () => {
  beforeEach(() => {
    mocks.fetchScholarlyText.mockReset();
  });

  it("builds direct title-search links for all three platforms", () => {
    const targets = buildChinesePlatformTargets("碱性无氰镀锌");

    expect(targets.map((target) => target.key)).toEqual(["cnki", "wanfang", "cqvip"]);
    expect(targets[0].searchUrl).toContain("kns.cnki.net/kns8s/defaultresult/index?kw=");
    expect(decodeURIComponent(targets[1].searchUrl)).toContain("q=碱性无氰镀锌");
    expect(decodeURIComponent(targets[2].searchUrl)).toContain("k=碱性无氰镀锌");
  });

  it("marks a matching indexed result as found", () => {
    const html = `
      <ol>
        <li class="b_algo"><h2><a href="https://kns.cnki.net/kcms2/article/abstract?v=1">碱性无氰镀锌工艺研究</a></h2></li>
      </ol>
    `;

    expect(classifyPlatformIndexHtml(html, "碱性无氰镀锌工艺研究", "cnki.net")).toBe("found");
  });

  it("does not mistake an unrelated result for platform availability", () => {
    const html = `
      <ol>
        <li class="b_algo"><h2><a href="https://www.cqvip.com/doc/journal/123">完全不同的论文题目</a></h2></li>
      </ol>
    `;

    expect(classifyPlatformIndexHtml(html, "碱性无氰镀锌工艺研究", "cqvip.com")).toBe("not-found");
  });

  it("reports an unavailable index page separately from no match", () => {
    expect(classifyPlatformIndexHtml("<html><body>Request blocked</body></html>", "测试论文", "cnki.net")).toBe("unavailable");
  });

  it("checks all three domains with one index request", async () => {
    mocks.fetchScholarlyText.mockResolvedValue(`
      <li class="b_algo"><h2><a href="https://kns.cnki.net/kcms2/article/abstract?v=1">低电流密度区碱性镀锌研究</a></h2></li>
      <li class="b_algo"><h2><a href="https://www.cqvip.com/doc/journal/123">低电流密度区碱性镀锌研究</a></h2></li>
    `);

    const results = await checkChinesePlatforms("低电流密度区碱性镀锌研究");

    expect(mocks.fetchScholarlyText).toHaveBeenCalledOnce();
    expect(results.filter((result) => result.status === "found").map((result) => result.key)).toEqual(["cnki", "cqvip"]);
    expect(results.find((result) => result.key === "wanfang")?.status).toBe("not-found");
  });
});
