import { describe, expect, it } from "vitest";

import {
  createQueryJob,
  isPositiveTabId,
  isQueryJob,
} from "../../src/shared/query-models";

const dependencies = {
  createId: () => "job-1",
  now: () => 1_777_777,
};

describe("QueryJob", () => {
  it("creates a bounded manual new-chat job", () => {
    const job = createQueryJob(
      {
        sourceTabId: 7,
        query: `  ${"q".repeat(4_200)}  `,
        sourceUrl: "https://www.google.com/search?q=q",
        mode: "manual",
        promptMode: "raw",
      },
      dependencies,
    );

    expect(job.id).toBe("job-1");
    expect(job.query).toHaveLength(4_096);
    expect(job.conversationMode).toBe("new_chat");
    expect(isQueryJob(job)).toBe(true);
  });

  it("rejects invalid source tabs and empty queries", () => {
    expect(isPositiveTabId(0)).toBe(false);
    expect(isPositiveTabId(1.5)).toBe(false);
    expect(() =>
      createQueryJob(
        {
          sourceTabId: -1,
          query: "query",
          sourceUrl: "https://www.google.com/search?q=query",
          mode: "manual",
          promptMode: "raw",
        },
        dependencies,
      ),
    ).toThrow("positive source tab id");
    expect(() =>
      createQueryJob(
        {
          sourceTabId: 1,
          query: "   ",
          sourceUrl: "https://www.google.com/search?q=",
          mode: "manual",
          promptMode: "raw",
        },
        dependencies,
      ),
    ).toThrow("non-empty query");
  });
});
