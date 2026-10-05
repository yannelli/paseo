import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { getAgentAttachmentPillContent } from "./attachment-pill-content";

describe("agent attachment pill content", () => {
  it("presents external resources with their provider identity", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "ENG-123 Plugin attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        externalResource: {
          provider: "linear",
          providerLabel: "Linear issue",
          resourceType: "issue",
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Plugin attachments");
    expect(content.subtitle).toBe("Linear issue ENG-123");
  });

  it("presents external resources without an identifier by provider alone", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "Code review checklist",
        text: "Read the diff before the tests.",
        externalResource: {
          provider: "prompts",
          providerLabel: "Saved prompt",
          resourceType: "prompt",
          id: "prompt-1",
          identifier: "",
          title: "Code review checklist",
          url: "https://example.com/prompts/prompt-1",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Code review checklist");
    expect(content.subtitle).toBe("Saved prompt");
  });
});
