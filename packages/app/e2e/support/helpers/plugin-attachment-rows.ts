import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openAttachmentMenu } from "./composer";
import { connectNewWorkspaceDaemonClient } from "./new-workspace";
import { pluginRequirements } from "./plugin-fixture";

const PLUGIN_ID = "attachment-rows-e2e";

export const LONG_PROMPT = {
  title: "Code review checklist",
  subtitle: Array.from(
    { length: 12 },
    (_, index) => `Step ${index + 1}: read the diff, run the tests, and note every risky change.`,
  ).join(" "),
};
export const SHORT_PROMPT = {
  title: "Release notes draft",
  subtitle: "Summarize merged pull requests by area",
};
export const ISSUE = {
  identifier: "ENG-1",
  title: "Fix login redirect",
  subtitle: "In progress · Ada",
};

function item(id: string, identifier: string, entry: { title: string; subtitle: string }) {
  return {
    id,
    identifier,
    title: entry.title,
    subtitle: entry.subtitle,
    url: `https://example.com/${id}`,
    text: `${entry.title}\n${entry.subtitle}`,
    resourceType: "prompt",
  };
}

const SHARED_SOURCE = `import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const output = z.object({ items: z.array(z.object({ id: z.string(), identifier: z.string(), title: z.string(), subtitle: z.string().optional(), url: z.string(), text: z.string(), resourceType: z.string() })) });
export const searchPrompts = defineRpc({ name: "prompts.search", input: z.object({ query: z.string() }), output });
export const searchIssues = defineRpc({ name: "issues.search", input: z.object({ query: z.string() }), output });
export const prompts = defineAttachmentSource({ id: "prompts", title: "Saved prompt", icon: "FileText", pickerTitle: "Attach saved prompt", searchPlaceholder: "Search prompts", search: searchPrompts, subtitleLines: 4 });
export const issues = defineAttachmentSource({ id: "issues", title: "Acme issue", icon: "CircleDot", pickerTitle: "Attach Acme issue", searchPlaceholder: "Search issues", search: searchIssues });
`;

const SERVER_SOURCE = `import { searchIssues, searchPrompts } from "./shared/sources";
const prompts = ${JSON.stringify([item("long-prompt", "", LONG_PROMPT), item("short-prompt", "", SHORT_PROMPT)])};
const issues = ${JSON.stringify([item("issue-1", ISSUE.identifier, ISSUE)])};
export default function contribute(server) {
  server.handle(searchPrompts, async () => ({ items: prompts }));
  server.handle(searchIssues, async () => ({ items: issues }));
  return () => {};
}
`;

const CLIENT_SOURCE = `import { issues, prompts } from "./shared/sources";
export default function contribute(client) {
  client.addAttachmentSource(prompts);
  client.addAttachmentSource(issues);
  return () => {};
}
`;

export async function installAttachmentRowsPlugin(): Promise<() => Promise<void>> {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await client.getDaemonConfig();
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-attachment-rows-"));
  await mkdir(path.join(directory, "shared"));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: PLUGIN_ID, requirements: pluginRequirements }),
  );
  await writeFile(path.join(directory, "shared/sources.ts"), SHARED_SOURCE);
  await writeFile(path.join(directory, "index.server.ts"), SERVER_SOURCE);
  await writeFile(path.join(directory, "index.client.ts"), CLIENT_SOURCE);
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await client.installDirectoryPlugin(directory);
  return async () => {
    await client.removePlugin(PLUGIN_ID);
    await client.patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false });
    await client.close();
    await rm(directory, { recursive: true, force: true });
  };
}

function pickerRow(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true });
}

export async function openPluginAttachmentPicker(
  page: Page,
  sourceTitle: string,
  firstLabel: string,
): Promise<void> {
  await openAttachmentMenu(page);
  await page.getByRole("menuitem", { name: `Attach ${sourceTitle}`, exact: true }).click();
  const row = pickerRow(page, firstLabel);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await waitForOpenAnimation(row);
}

async function waitForOpenAnimation(row: Locator): Promise<void> {
  let previousY: number | null = null;
  await expect
    .poll(
      async () => {
        const y = (await row.boundingBox())?.y ?? null;
        const settled = y !== null && y === previousY;
        previousY = y;
        return settled;
      },
      { intervals: [100] },
    )
    .toBe(true);
}

export async function saveScreenshot(page: Page, info: TestInfo, name: string) {
  await info.attach(name, {
    body: await page.screenshot({ path: info.outputPath(`${name}.png`) }),
    contentType: "image/png",
  });
}

async function rowText(page: Page, label: string, text: string) {
  const locator = pickerRow(page, label).getByText(text, { exact: true });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`"${text}" has no layout box`);
  return { box, raw: await locator.textContent() };
}

export async function expectStackedRow(
  page: Page,
  label: string,
  entry: { subtitle: string },
): Promise<{ subtitleHeight: number }> {
  const title = await rowText(page, label, label);
  const subtitle = await rowText(page, label, entry.subtitle);
  expect(title.raw).toBe(label);
  expect(subtitle.box.y).toBeGreaterThanOrEqual(title.box.y + title.box.height - 1);
  expect(Math.abs(subtitle.box.x - title.box.x)).toBeLessThanOrEqual(1);
  return { subtitleHeight: subtitle.box.height };
}

export async function expectInlineRow(page: Page, label: string, entry: { subtitle: string }) {
  const title = await rowText(page, label, label);
  const subtitle = await rowText(page, label, entry.subtitle);
  expect(title.raw).toBe(label);
  expect(subtitle.box.y).toBeLessThan(title.box.y + title.box.height);
  expect(subtitle.box.y + subtitle.box.height).toBeGreaterThan(title.box.y);
  expect(subtitle.box.x).toBeGreaterThanOrEqual(title.box.x + title.box.width - 1);
}

export async function expectPluginAttachmentPill(page: Page, sourceTitle: string, title: string) {
  const pill = page.getByTestId("composer-plugin-resource-attachment-pill");
  await expect(pill).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: `Open ${sourceTitle} ${title}`, exact: true }),
  ).toBeVisible();
  expect(await pill.getByText(sourceTitle, { exact: true }).textContent()).toBe(sourceTitle);
}

export async function expectSentPluginAttachment(page: Page, sourceTitle: string, title: string) {
  const message = page.getByTestId("user-message").filter({ hasText: title });
  await expect(message).toBeVisible({ timeout: 30_000 });
  expect(await message.getByText(sourceTitle, { exact: true }).textContent()).toBe(sourceTitle);
}
