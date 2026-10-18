import { api } from '../api.js';
import { signIn } from '../session.js';
import { h, field, bindForm, formError } from '../ui.js';

function safeNext(query) {
  const next = query.get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function renderLogin(view, ctx) {
  const next = safeNext(ctx.query);
  const form = bindForm(
    h(
      'form',
      { class: 'auth-form' },
      field('Email', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
      field('Password', h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
      formError(),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Log in'),
    ),
    async (data) => {
      signIn(await api.post('/auth/login', { email: data.get('email'), password: data.get('password') }));
      ctx.navigate(next);
    },
  );
  ctx.mount(
    h(
      'div',
      { class: 'auth card' },
      h('h1', {}, 'Welcome back'),
      form,
      h('p', { class: 'muted' }, 'New here? ', h('a', { href: `#/signup?next=${encodeURIComponent(next)}` }, 'Create an account')),
    ),
  );
}

export function renderSignup(view, ctx) {
  const next = safeNext(ctx.query);
  const form = bindForm(
    h(
      'form',
      { class: 'auth-form' },
      field('Name', h('input', { type: 'text', name: 'displayName', required: true, minlength: 2, maxlength: 40, autocomplete: 'name' }), 'This is what other players see.'),
      field('Email', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
      field('Password', h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'At least 8 characters.'),
      formError(),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Create account'),
    ),
    async (data) => {
      signIn(
        await api.post('/auth/signup', {
          displayName: data.get('displayName'),
          email: data.get('email'),
          password: data.get('password'),
        }),
      );
      ctx.navigate(next);
    },
  );
  ctx.mount(
    h(
      'div',
      { class: 'auth card' },
      h('h1', {}, 'Join the game'),
      h('p', { class: 'muted' }, 'Find pickup games near you, join a team, and play.'),
      form,
      h('p', { class: 'muted' }, 'Already have an account? ', h('a', { href: `#/login?next=${encodeURIComponent(next)}` }, 'Log in')),
    ),
  );
}
