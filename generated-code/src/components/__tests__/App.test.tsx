import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

describe('App routes and navigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('navigates from home to topic detail through real UI interaction', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /create new topic/i }));

    const textboxes = screen.getAllByRole('textbox');
    await user.type(textboxes[0], 'Navigation Topic');
    if (textboxes[1]) await user.type(textboxes[1], 'Navigation Body');

    const form = textboxes[0].closest('form');
    const submitButton =
      (form?.querySelector('button[type="submit"]') as HTMLButtonElement | null) ??
      screen.getByRole('button', { name: /create|submit/i });

    await user.click(submitButton);

    await user.click(await screen.findByText(/navigation topic/i));

    expect(screen.getByRole('button', { name: /submit reply|reply|submit/i })).toBeInTheDocument();
  });
});
