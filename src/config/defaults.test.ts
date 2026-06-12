import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./defaults.js";

describe("default config", () => {
  it("supports saved local document sources", () => {
    const cfg = ConfigSchema.parse({
      document_sources: [
        {
          id: "client-folder",
          path: "/tmp/client-folder",
        },
      ],
    });

    expect(cfg.document_sources).toEqual([
      {
        id: "client-folder",
        path: "/tmp/client-folder",
        glob: "**/*.{md,markdown,txt,docx,pdf}",
      },
    ]);
    expect(cfg.active_task_profile_id).toBeNull();
    expect(cfg.task_profiles).toEqual([]);
  });

  it("supports named task profiles", () => {
    const cfg = ConfigSchema.parse({
      active_task_profile_id: "profile-a",
      task_profiles: [
        {
          id: "profile-a",
          name: "Claims Review",
          document_sources: [
            {
              id: "claim-docs",
              path: "/tmp/claims",
            },
          ],
          rule_ids: ["C001"],
          created_at: "2026-05-27T00:00:00.000Z",
          updated_at: "2026-05-27T00:00:00.000Z",
        },
      ],
    });

    expect(cfg.active_task_profile_id).toBe("profile-a");
    expect(cfg.task_profiles[0]).toMatchObject({
      id: "profile-a",
      name: "Claims Review",
      rule_ids: ["C001"],
      document_sources: [
        {
          id: "claim-docs",
          path: "/tmp/claims",
          glob: "**/*.{md,markdown,txt,docx,pdf}",
        },
      ],
    });
  });
});
