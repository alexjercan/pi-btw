# AGENTS.md

`~/AGENTS.md` applies.

## Project

- `pi-btw` owns Pi side threads, the Neovim request queue, and their transport.
- Pi code lives in `extensions/pi-btw/`. Neovim code lives in `nvim/`.
- Tests live in `tests/`. Configuration examples live in `examples/`.
- Keep both ends of the bridge protocol and their tests in this project.
- Do not depend on files in `nix.dotfiles` or another checkout.

## Workflow

- Work on `master` unless the user requests an isolated worktree.
- Use Tatr for requested tracked work. Keep task records under `tasks/<id>/`.
- Keep implementation changes scoped to the approved request.
- Put host-provided Pi APIs in `peerDependencies`, not runtime dependencies.
- Keep side-thread data outside main model context until explicitly sent.
- Preserve read-only tools and cancellation on session replacement.
- Format Nix with Alejandra and TypeScript with Prettier.
- Run `npm run check` and `nix flake check` before completion.

## Commands

```fish
nix develop
npm ci
npm run check
nix flake check
```
