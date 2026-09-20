import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), loginAsDemoClinician: vi.fn() }),
}));

import { Login } from '../Login';

describe('clinician sample workspace entry', () => {
  it('labels the development-only entry as fictional and isolated', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>,
    );

    expect(html).toContain('Demo environment');
    expect(html).toContain('Open Sample Clinician Workspace');
    expect(html).toContain('Fictional sample records for demonstration only');
    expect(html).toContain('isolated from production accounts');
  });
});
