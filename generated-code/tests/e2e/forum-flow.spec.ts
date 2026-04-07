import { expect, Locator, Page, test } from "@playwright/test";

async function clearBrowserStorage(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

async function openCreateTopicForm(page: Page): Promise<Locator> {
  const createBtn = page.getByRole("button", { name: /create new topic|create topic|new topic/i });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    return dialog.first();
  }
  return page.locator("body");
}

async function submitTopic(scope: Locator, title: string, body?: string) {
  const textboxes = scope.getByRole("textbox");
  const textboxCount = await textboxes.count();

  expect(textboxCount).toBeGreaterThan(0);
  await textboxes.first().fill(title);

  if (body && textboxCount > 1) {
    await textboxes.nth(1).fill(body);
  }

  const submitBtn = scope.getByRole("button", { name: /create|submit|save|add/i }).first();
  await expect(submitBtn).toBeVisible();
  await submitBtn.click();
}

async function openTopicFromList(page: Page, title: string) {
  const topicLink = page.getByRole("link", { name: title });
  if (await topicLink.count()) {
    await topicLink.first().click();
    return;
  }

  const topicButton = page.getByRole("button", { name: title });
  if (await topicButton.count()) {
    await topicButton.first().click();
    return;
  }

  await page.getByText(title, { exact: true }).first().click();
}

async function submitReply(page: Page, text: string) {
  const replyInputs = page.getByRole("textbox");
  const replyInputCount = await replyInputs.count();
  expect(replyInputCount).toBeGreaterThan(0);

  await replyInputs.first().fill(text);

  const submitReplyBtn = page.getByRole("button", { name: /submit reply|reply|post|send|submit/i }).first();
  await expect(submitReplyBtn).toBeVisible();
  await submitReplyBtn.click();
}

test.describe("Forum app e2e flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserStorage(page);
  });

  test("user can create topic on home and navigate to topic detail", async ({ page }) => {
    const topicTitle = `E2E Topic ${Date.now()}`;
    const topicBody = "Topic body from e2e";

    const scope = await openCreateTopicForm(page);
    await submitTopic(scope, topicTitle, topicBody);

    await expect(page.getByText(topicTitle)).toBeVisible();

    await openTopicFromList(page, topicTitle);
    await expect(page).toHaveURL(/\/topic\//);
    await expect(page.getByText(topicTitle)).toBeVisible();
  });

  test("user can post reply, edit it, and delete it", async ({ page }) => {
    const topicTitle = `Reply Flow Topic ${Date.now()}`;
    const initialReply = `Initial reply ${Date.now()}`;
    const editedReply = `${initialReply} (edited)`;

    const scope = await openCreateTopicForm(page);
    await submitTopic(scope, topicTitle, "seed topic for reply flow");
    await openTopicFromList(page, topicTitle);

    await submitReply(page, initialReply);
    await expect(page.getByText(initialReply)).toBeVisible();

    const editBtn = page.getByRole("button", { name: /edit/i }).first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const dialog = page.getByRole("dialog");
    const editScope = (await dialog.count()) ? dialog.first() : page.locator("body");
    const editInputs = editScope.getByRole("textbox");
    const editInputCount = await editInputs.count();
    expect(editInputCount).toBeGreaterThan(0);
    await editInputs.first().fill(editedReply);

    const saveBtn = editScope.getByRole("button", { name: /save|submit|update/i }).first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    await expect(page.getByText(editedReply)).toBeVisible();

    const deleteBtn = page.getByRole("button", { name: /delete/i }).first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    const confirmDelete = page.getByRole("button", { name: /confirm|delete/i });
    if (await confirmDelete.count()) {
      await confirmDelete.first().click();
    }

    await expect(page.getByText(editedReply)).toHaveCount(0);
  });

  test("data persists in localStorage after page refresh", async ({ page }) => {
    const topicTitle = `Persistence Topic ${Date.now()}`;
    const replyText = `Persistence Reply ${Date.now()}`;

    const scope = await openCreateTopicForm(page);
    await submitTopic(scope, topicTitle, "persist me");
    await openTopicFromList(page, topicTitle);
    await submitReply(page, replyText);

    await expect(page.getByText(replyText)).toBeVisible();

    await page.reload();
    await expect(page.getByText(replyText)).toBeVisible();

    await page.goto("/");
    await expect(page.getByText(topicTitle)).toBeVisible();

    await openTopicFromList(page, topicTitle);
    await expect(page.getByText(replyText)).toBeVisible();
  });
});
