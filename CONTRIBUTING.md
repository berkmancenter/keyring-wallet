## How to Contribute

Government employees, public and members of the private sector are encouraged to contribute to the repository by **forking and submitting a pull request**. 

(If you are new to GitHub, you might start with a [basic tutorial](https://help.github.com/articles/set-up-git) and  check out a more detailed guide to [pull requests](https://help.github.com/articles/using-pull-requests/).)

Pull requests will be evaluated by the repository guardians on a schedule and if deemed beneficial will be committed to the master.

All contributors retain the original copyright to their stuff, but by contributing to this project, you grant a world-wide, royalty-free, perpetual, irrevocable, non-exclusive, transferable license to all users **under the terms of the license under which this project is distributed.**

## Commit Requirements

Every commit on `main` must:

1. **Carry a DCO sign-off** — a `Signed-off-by:` trailer, added automatically with `git commit -s`. Enforced locally by the `commit-msg` hook (via commitlint) and, redundantly, by CI.
2. **Be cryptographically signed** (GPG or SSH) and verified by GitHub. Branch protection on `main` rejects unsigned commits outright; CI double-checks every commit on a pull request. A git hook can't verify the signature itself, since git signs a commit *after* hooks run — the local `pre-commit` hook only checks that signing is configured (`commit.gpgsign true`).

See GitHub's guide to [signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification) if you haven't set this up. The `bifold/` submodule has the same requirements — see `bifold/CONTRIBUTING` for its one-time hook setup (`git config core.hooksPath .githooks`, run automatically by `yarn install` at the repo root).
