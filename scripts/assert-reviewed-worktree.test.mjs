import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDirectory, 'assert-reviewed-worktree.mjs');

async function git(root, ...arguments_) {
  return execFileAsync('git', arguments_, {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

async function initializeRepository(context, name = 'reviewed-tree-') {
  const root = await mkdtemp(join(tmpdir(), name));
  context.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--quiet');
  await git(root, 'config', 'user.name', 'GiwaPay Test');
  await git(root, 'config', 'user.email', 'giwapay-test@example.invalid');
  return root;
}

async function commitAll(root, message) {
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', message);
  return (await git(root, 'rev-parse', 'HEAD')).stdout.trim();
}

async function runChecker(root, commit, ...paths) {
  return execFileAsync(process.execPath, [checker, root, commit, ...paths], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

async function materialize(root, commit, destination, ...paths) {
  return execFileAsync(
    process.execPath,
    [checker, root, commit, '--materialize', destination, ...paths],
    {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function runCheckerWithEnvironment(root, commit, paths, environment) {
  return execFileAsync(process.execPath, [checker, root, commit, ...paths], {
    env: environment,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

test('accepts a clean reviewed path', async (context) => {
  const root = await initializeRepository(context);
  await mkdir(join(root, 'contracts'));
  await writeFile(join(root, 'contracts', 'Payment.sol'), 'contract Payment {}\n');
  const commit = await commitAll(root, 'initial');

  await runChecker(root, commit, 'contracts');
});

test('materializes immutable reviewed bytes and recursive dependencies outside the worktree', async (context) => {
  const dependency = await initializeRepository(context, 'reviewed-materialized-dependency-');
  await writeFile(join(dependency, 'Dependency.sol'), 'contract Dependency {}\n');
  await commitAll(dependency, 'dependency');

  const root = await initializeRepository(context, 'reviewed-materialized-parent-');
  await mkdir(join(root, 'contracts'));
  await writeFile(join(root, 'contracts', 'Payment.sol'), 'contract Payment {}\n');
  await git(
    root,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '--quiet',
    dependency,
    'contracts/lib/dependency',
  );
  const commit = await commitAll(root, 'parent');
  const destination = await mkdtemp(join(tmpdir(), 'reviewed-materialized-output-'));
  context.after(() => rm(destination, { recursive: true, force: true }));

  await materialize(root, commit, destination, 'contracts');

  assert.equal(
    await readFile(join(destination, 'contracts', 'Payment.sol'), 'utf8'),
    'contract Payment {}\n',
  );
  assert.equal(
    await readFile(join(destination, 'contracts', 'lib', 'dependency', 'Dependency.sol'), 'utf8'),
    'contract Dependency {}\n',
  );
  assert.equal((await stat(join(destination, 'contracts', 'Payment.sol'))).mode & 0o222, 0);
  await assert.rejects(access(join(destination, 'contracts', '.git')), /ENOENT/);
});

for (const indexFlag of ['--assume-unchanged', '--skip-worktree']) {
  test(`rejects a hidden ${indexFlag} modification`, async (context) => {
    const root = await initializeRepository(context);
    await mkdir(join(root, 'contracts'));
    const sourcePath = join(root, 'contracts', 'Payment.sol');
    await writeFile(sourcePath, 'contract Payment {}\n');
    const commit = await commitAll(root, 'initial');
    await git(root, 'update-index', indexFlag, 'contracts/Payment.sol');
    await writeFile(sourcePath, 'contract Payment { function changed() external {} }\n');

    await assert.rejects(
      runChecker(root, commit, 'contracts'),
      /special Git index state is not allowed/,
    );
  });
}

test('rejects an untracked file in reviewed scope', async (context) => {
  const root = await initializeRepository(context);
  await mkdir(join(root, 'contracts'));
  await writeFile(join(root, 'contracts', 'Payment.sol'), 'contract Payment {}\n');
  const commit = await commitAll(root, 'initial');
  await writeFile(join(root, 'contracts', 'Unreviewed.sol'), 'contract Unreviewed {}\n');

  await assert.rejects(runChecker(root, commit, 'contracts'), /untracked file/);
});

test('rejects an ignored untracked file in reviewed scope', async (context) => {
  const root = await initializeRepository(context);
  await mkdir(join(root, 'contracts'));
  await writeFile(join(root, 'contracts', 'Payment.sol'), 'contract Payment {}\n');
  const commit = await commitAll(root, 'initial');
  await writeFile(join(root, '.git', 'info', 'exclude'), 'contracts/Ignored.sol\n');
  await writeFile(join(root, 'contracts', 'Ignored.sol'), 'contract Ignored {}\n');

  await assert.rejects(runChecker(root, commit, 'contracts'), /including an ignored file/);
});

test('rejects raw bytes hidden by a Git clean filter', async (context) => {
  const root = await initializeRepository(context);
  await mkdir(join(root, 'contracts'));
  const sourcePath = join(root, 'contracts', 'Payment.sol');
  await writeFile(join(root, 'contracts', '.gitattributes'), 'Payment.sol filter=reviewed-clean\n');
  await git(root, 'config', 'filter.reviewed-clean.clean', "sed '/MALICIOUS/d'");
  await git(root, 'config', 'filter.reviewed-clean.smudge', 'cat');
  await writeFile(sourcePath, 'contract Payment {}\n');
  const commit = await commitAll(root, 'initial');
  await writeFile(sourcePath, 'contract Payment {}\n// MALICIOUS\n');
  await git(root, 'add', 'contracts/Payment.sol');

  const filteredObject = await git(root, 'hash-object', 'contracts/Payment.sol');
  const reviewedObject = await git(root, 'rev-parse', `${commit}:contracts/Payment.sol`);
  assert.equal(filteredObject.stdout.toString(), reviewedObject.stdout.toString());
  const status = await git(root, 'status', '--porcelain', '--', 'contracts');
  assert.equal(status.stdout.toString(), '');
  await assert.rejects(runChecker(root, commit, 'contracts'), /raw worktree bytes differ/);
});

test('rejects same-size raw bytes hidden by the Git stat cache', async (context) => {
  const root = await initializeRepository(context);
  await git(root, 'config', 'core.trustctime', 'false');
  await mkdir(join(root, 'contracts'));
  const sourcePath = join(root, 'contracts', 'Payment.sol');
  const timestampReference = join(root, 'reference-time');
  await writeFile(sourcePath, 'AAAA\n');
  await delay(2_100);
  const commit = await commitAll(root, 'initial');
  await execFileAsync('cp', ['-p', sourcePath, timestampReference]);
  await writeFile(sourcePath, 'BBBB\n');
  await execFileAsync('touch', ['-r', timestampReference, sourcePath]);

  const status = await git(root, 'status', '--porcelain', '--', 'contracts');
  assert.equal(status.stdout.toString(), '');
  await assert.rejects(runChecker(root, commit, 'contracts'), /raw worktree bytes differ/);
});

test('rejects Git replacement refs that rewrite a reviewed commit', async (context) => {
  const root = await initializeRepository(context);
  await mkdir(join(root, 'contracts'));
  const sourcePath = join(root, 'contracts', 'Payment.sol');
  await writeFile(sourcePath, 'contract Reviewed {}\n');
  const reviewedCommit = await commitAll(root, 'reviewed');
  await writeFile(sourcePath, 'contract Replacement {}\n');
  const replacementCommit = await commitAll(root, 'replacement');
  await git(root, 'replace', reviewedCommit, replacementCommit);

  await assert.rejects(runChecker(root, reviewedCommit, 'contracts'), /replacement refs/);
});

test('ignores inherited Git repository redirects when resolving the reviewed root', async (context) => {
  const reviewedRoot = await initializeRepository(context, 'reviewed-actual-');
  await mkdir(join(reviewedRoot, 'contracts'));
  const reviewedSource = join(reviewedRoot, 'contracts', 'Payment.sol');
  await writeFile(reviewedSource, 'contract Reviewed {}\n');
  await commitAll(reviewedRoot, 'reviewed');

  const redirectedRoot = await initializeRepository(context, 'reviewed-redirect-');
  await mkdir(join(redirectedRoot, 'contracts'));
  await writeFile(join(redirectedRoot, 'contracts', 'Payment.sol'), 'contract Redirected {}\n');
  const redirectedCommit = await commitAll(redirectedRoot, 'redirected');
  await writeFile(reviewedSource, 'contract Redirected {}\n');

  await assert.rejects(
    runCheckerWithEnvironment(reviewedRoot, redirectedCommit, ['contracts'], {
      ...process.env,
      GIT_DIR: join(redirectedRoot, '.git'),
      GIT_WORK_TREE: reviewedRoot,
    }),
    /reviewed Git scope check failed/,
  );
});

test('rejects a hidden modification inside a recursive dependency submodule', async (context) => {
  const dependency = await initializeRepository(context, 'reviewed-dependency-');
  await writeFile(join(dependency, 'Dependency.sol'), 'contract Dependency {}\n');
  await commitAll(dependency, 'dependency');

  const root = await initializeRepository(context, 'reviewed-parent-');
  await git(
    root,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '--quiet',
    dependency,
    'contracts/lib/dependency',
  );
  const commit = await commitAll(root, 'parent');
  const submoduleRoot = join(root, 'contracts', 'lib', 'dependency');
  await git(submoduleRoot, 'update-index', '--skip-worktree', 'Dependency.sol');
  await writeFile(
    join(submoduleRoot, 'Dependency.sol'),
    'contract Dependency { function changed() external {} }\n',
  );

  await assert.rejects(
    runChecker(root, commit, 'contracts'),
    /special Git index state is not allowed/,
  );
});
