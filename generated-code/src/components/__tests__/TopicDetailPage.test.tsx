import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from '../../pages/HomePage';
import TopicDetailPage from '../../pages/TopicDetailPage';

const renderForumFlow = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/topic/:id" element={<TopicDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

const createTopicAndOpenDetails = async (title: string) => {
  const user = userEvent.setup();
  renderForumFlow();

  await user.click(screen.getByRole('button', { name: /create new topic/i }));

  const textboxes = screen.getAllByRole('textbox');
  await user.type(textboxes[0], title);
  if (textboxes[1]) await user.type(textboxes[1], 'Topic body');

  const form = textboxes[0].closest('form') as HTMLFormElement;
  const submitButton =
    within(form).queryByRole('button', { name: /create|submit/i }) ??
    screen.getByRole('button', { name: /create|submit/i });

  await user.click(submitButton);

  await user.click(await screen.findByText(title));

  return user;
};

describe('TopicDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds a reply on submit and clears input', async () => {
    const user = await createTopicAndOpenDetails('Reply Test Topic');

    const replyInput =
      screen.queryByPlaceholderText(/reply/i) ??
      screen.queryByLabelText(/reply/i) ??
      screen.getByRole('textbox');

    await user.type(replyInput, 'This is my first reply');
    expect(replyInput).toHaveValue('This is my first reply');

    await user.click(screen.getByRole('button', { name: /submit reply|reply|submit/i }));

    expect(
      await screen.findByText(/this is my first reply/i)
    ).toBeInTheDocument();
    expect(replyInput).toHaveValue('');
  });

  it('supports edit and delete actions for replies', async () => {
    const user = await createTopicAndOpenDetails('Edit/Delete Reply Topic');

    const replyInput =
      screen.queryByPlaceholderText(/reply/i) ??
      screen.queryByLabelText(/reply/i) ??
      screen.getByRole('textbox');

    await user.type(replyInput, 'Reply to edit and delete');
    await user.click(screen.getByRole('button', { name: /submit reply|reply|submit/i }));

    expect(
      await screen.findByText(/reply to edit and delete/i)
    ).toBeInTheDocument();

    const editButton = screen.getByRole('button', { name: /edit/i });
    await user.click(editButton);

    const editInput =
      screen.queryByDisplayValue(/reply to edit and delete/i) ??
      screen.getAllByRole('textbox')[0];

    await user.clear(editInput);
    await user.type(editInput, 'Reply edited');
    expect(editInput).toHaveValue('Reply edited');

    const saveButton =
      screen.queryByRole('button', { name: /save|update|submit/i }) ??
      screen.getByRole('button', { name: /edit/i });

    await user.click(saveButton);

    expect(await screen.findByText(/reply edited/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.queryByText(/reply edited/i)).not.toBeInTheDocument();
  });
});
