import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from '../../pages/HomePage';

const setup = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );

const getPrimaryForm = () => {
  const textboxes = screen.getAllByRole('textbox');
  const form = textboxes[0]?.closest('form');
  if (!form) throw new Error('Expected a topic creation form to be rendered');
  return form as HTMLFormElement;
};

describe('HomePage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders topic list area and create topic trigger', () => {
    setup();

    expect(
      screen.getByRole('button', { name: /create new topic/i })
    ).toBeInTheDocument();
  });

  it('allows opening create topic UI and keeps inputs controlled', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /create new topic/i }));

    const titleInput =
      screen.queryByLabelText(/title/i) ?? screen.getAllByRole('textbox')[0];

    await user.clear(titleInput);
    await user.type(titleInput, 'My First Topic');

    expect(titleInput).toHaveValue('My First Topic');
  });

  it('submits a new topic through form onSubmit and renders it in the list', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /create new topic/i }));

    const textboxes = screen.getAllByRole('textbox');
    const titleInput = textboxes[0];
    const bodyInput = textboxes[1];

    await user.type(titleInput, 'Topic created from test');
    if (bodyInput) {
      await user.type(bodyInput, 'Body content from test');
      expect(bodyInput).toHaveValue('Body content from test');
    }

    const form = getPrimaryForm();
    const submitButton =
      within(form).queryByRole('button', { name: /create|submit/i }) ??
      screen.getByRole('button', { name: /create|submit/i });

    await user.click(submitButton);

    expect(
      await screen.findByText(/topic created from test/i)
    ).toBeInTheDocument();
  });

  it('prevents empty topic submission (validation)', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /create new topic/i }));

    const beforeLinks = screen.queryAllByRole('link').length;
    const beforeItems = screen.queryAllByRole('listitem').length;

    const form = getPrimaryForm();
    const submitButton =
      within(form).queryByRole('button', { name: /create|submit/i }) ??
      screen.getByRole('button', { name: /create|submit/i });

    await user.click(submitButton);

    const afterLinks = screen.queryAllByRole('link').length;
    const afterItems = screen.queryAllByRole('listitem').length;

    expect(afterLinks).toBe(beforeLinks);
    expect(afterItems).toBe(beforeItems);
  });
});
