import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const [repositoryRootValue, reviewedCommit, ...remainingArguments] = process.argv.slice(2);
const commitPattern = /^[0-9a-fA-F]{40,64}$/;
let reviewedPaths = remainingArguments;
let materializeDestination;
if (remainingArguments[0] === '--materialize') {
  materializeDestination = remainingArguments[1];
  reviewedPaths = remainingArguments.slice(2);
}
const gitEnvironment = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
for (const environmentName of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_REPLACE_REF_BASE',
  'GIT_NAMESPACE',
  'GIT_SHALLOW_FILE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
]) {
  delete gitEnvironment[environmentName];
}
for (const environmentName of Object.keys(gitEnvironment)) {
  if (
    environmentName.startsWith('GIT_CONFIG_KEY_') ||
    environmentName.startsWith('GIT_CONFIG_VALUE_')
  ) {
    delete gitEnvironment[environmentName];
  }
}

if (
  !repositoryRootValue ||
  !commitPattern.test(reviewedCommit ?? '') ||
  (remainingArguments[0] === '--materialize' && !materializeDestination) ||
  reviewedPaths.length === 0
) {
  throw new Error(
    'Usage: node scripts/assert-reviewed-worktree.mjs <repository-root> <reviewed-commit> [--materialize <destination>] <path>...',
  );
}

const repositoryRoot = resolve(repositoryRootValue);
await git(repositoryRoot, ['cat-file', '-e', `${reviewedCommit}^{commit}`]);
await assertReviewedScope(repositoryRoot, reviewedCommit, reviewedPaths);
if (materializeDestination) {
  await materializeReviewedScope(
    repositoryRoot,
    reviewedCommit,
    reviewedPaths,
    resolve(materializeDestination),
  );
}

async function assertReviewedScope(root, commit, paths) {
  const [expectedRoot, discoveredRoot] = await Promise.all([
    realpath(root),
    git(root, ['rev-parse', '--show-toplevel']).then((value) => realpath(value.trim())),
  ]);
  if (expectedRoot !== discoveredRoot) {
    throw new Error('Git repository discovery does not match the reviewed repository root');
  }
  await assertNoHistoryOverrides(root);
  const pathArguments = paths.length > 0 ? ['--', ...paths] : ['--'];
  const indexState = await git(root, ['ls-files', '-v', '-z', ...pathArguments]);
  for (const record of indexState.split('\0').filter(Boolean)) {
    if (!record.startsWith('H ')) {
      throw new Error(`special Git index state is not allowed in reviewed scope: ${record}`);
    }
  }

  const untracked = await git(root, ['ls-files', '--others', '-z', ...pathArguments]);
  if (untracked.length > 0) {
    throw new Error('reviewed scope contains an untracked file, including an ignored file');
  }

  const reviewedTree = parseReviewedTree(
    await git(root, ['ls-tree', '-r', '-z', commit, ...pathArguments]),
  );
  const indexedTree = parseIndexedTree(await git(root, ['ls-files', '-s', '-z', ...pathArguments]));
  if (reviewedTree.size !== indexedTree.size) {
    throw new Error('reviewed scope path set differs from the reviewed commit');
  }

  for (const [path, reviewedEntry] of reviewedTree) {
    const indexedEntry = indexedTree.get(path);
    if (
      !indexedEntry ||
      indexedEntry.mode !== reviewedEntry.mode ||
      indexedEntry.object !== reviewedEntry.object
    ) {
      throw new Error(`reviewed index entry differs from the reviewed commit: ${path}`);
    }

    if (reviewedEntry.mode === '160000') {
      const submoduleRoot = resolve(root, path);
      const submoduleHead = (await git(submoduleRoot, ['rev-parse', 'HEAD'])).trim().toLowerCase();
      if (submoduleHead !== reviewedEntry.object) {
        throw new Error(`submodule HEAD differs from the reviewed gitlink: ${path}`);
      }
      await git(submoduleRoot, ['cat-file', '-e', `${reviewedEntry.object}^{commit}`]);
      await assertReviewedScope(submoduleRoot, reviewedEntry.object, []);
      continue;
    }

    if (
      reviewedEntry.type !== 'blob' ||
      (reviewedEntry.mode !== '100644' && reviewedEntry.mode !== '100755')
    ) {
      throw new Error(`unsupported reviewed tree entry: ${reviewedEntry.mode} ${path}`);
    }
    const worktreePath = resolve(root, path);
    let worktreeStats;
    try {
      worktreeStats = await lstat(worktreePath);
    } catch {
      throw new Error(`reviewed worktree file is missing: ${path}`);
    }
    if (!worktreeStats.isFile()) {
      throw new Error(`reviewed worktree path is not a regular file: ${path}`);
    }
    const worktreeExecutable = (worktreeStats.mode & 0o111) !== 0;
    if (worktreeExecutable !== (reviewedEntry.mode === '100755')) {
      throw new Error(`reviewed worktree executable mode differs: ${path}`);
    }
    const rawWorktreeObject = (await git(root, ['hash-object', '--no-filters', '--', path])).trim();
    if (rawWorktreeObject.toLowerCase() !== reviewedEntry.object) {
      throw new Error(`raw worktree bytes differ from the reviewed commit: ${path}`);
    }
  }
}

async function materializeReviewedScope(root, commit, paths, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const [repositoryRealPath, destinationRealPath, destinationStats] = await Promise.all([
    realpath(root),
    realpath(destination),
    lstat(destination),
  ]);
  if (
    !destinationStats.isDirectory() ||
    destinationStats.isSymbolicLink() ||
    destinationRealPath === repositoryRealPath ||
    destinationRealPath.startsWith(`${repositoryRealPath}${sep}`)
  ) {
    throw new Error('materialized reviewed scope must use a real directory outside the repository');
  }

  const pathArguments = paths.length > 0 ? ['--', ...paths] : [];
  const reviewedTree = parseReviewedTree(
    await git(root, ['ls-tree', '-r', '-z', commit, ...pathArguments]),
  );
  for (const path of reviewedTree.keys()) {
    assertSafeTreePath(path, destinationRealPath);
  }

  for (const [path, reviewedEntry] of reviewedTree) {
    const materializedPath = resolve(destinationRealPath, path);
    if (reviewedEntry.mode === '160000') {
      const submoduleRoot = resolve(root, path);
      await mkdir(materializedPath, { recursive: true, mode: 0o700 });
      await materializeReviewedScope(submoduleRoot, reviewedEntry.object, [], materializedPath);
      continue;
    }
    await mkdir(dirname(materializedPath), { recursive: true, mode: 0o700 });
    const reviewedBytes = await gitBytes(root, ['cat-file', 'blob', reviewedEntry.object]);
    await writeFile(materializedPath, reviewedBytes, {
      flag: 'wx',
      mode: reviewedEntry.mode === '100755' ? 0o500 : 0o400,
    });
    const materializedStats = await lstat(materializedPath);
    if (!materializedStats.isFile() || materializedStats.isSymbolicLink()) {
      throw new Error(`materialized reviewed path is not a regular file: ${path}`);
    }
    await chmod(materializedPath, reviewedEntry.mode === '100755' ? 0o555 : 0o444);
  }
}

function assertSafeTreePath(path, destination) {
  const normalized = normalize(path);
  const resolvedPath = resolve(destination, path);
  if (
    !path ||
    isAbsolute(path) ||
    normalized !== path ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    (resolvedPath !== destination && !resolvedPath.startsWith(`${destination}${sep}`))
  ) {
    throw new Error(`unsafe reviewed tree path: ${path}`);
  }
}

async function assertNoHistoryOverrides(root) {
  const replacementRefs = await git(root, ['replace', '-l']);
  if (replacementRefs.trim().length > 0) {
    throw new Error('Git replacement refs are not allowed in a reviewed repository');
  }
  const graftsPathValue = (await git(root, ['rev-parse', '--git-path', 'info/grafts'])).trim();
  const graftsPath = resolve(root, graftsPathValue);
  try {
    const grafts = await readFile(graftsPath, 'utf8');
    if (grafts.trim().length > 0) {
      throw new Error('Git grafts are not allowed in a reviewed repository');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function parseReviewedTree(value) {
  const entries = new Map();
  for (const record of value.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, separator).split(' ');
    const path = record.slice(separator + 1);
    if (
      separator < 0 ||
      !mode ||
      !type ||
      !commitPattern.test(object ?? '') ||
      !path ||
      entries.has(path)
    ) {
      throw new Error(`could not parse reviewed tree entry: ${record}`);
    }
    entries.set(path, { mode, type, object: object.toLowerCase() });
  }
  return entries;
}

function parseIndexedTree(value) {
  const entries = new Map();
  for (const record of value.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    const [mode, object, stage] = record.slice(0, separator).split(' ');
    const path = record.slice(separator + 1);
    if (
      separator < 0 ||
      !mode ||
      !commitPattern.test(object ?? '') ||
      stage !== '0' ||
      !path ||
      entries.has(path)
    ) {
      throw new Error(`could not parse reviewed index entry: ${record}`);
    }
    entries.set(path, { mode, object: object.toLowerCase() });
  }
  return entries;
}

async function git(root, arguments_) {
  try {
    const { stdout } = await execFileAsync('git', arguments_, {
      cwd: root,
      env: gitEnvironment,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail =
      typeof error?.stderr === 'string' && error.stderr.trim().length > 0
        ? `: ${error.stderr.trim()}`
        : '';
    throw new Error(`reviewed Git scope check failed (${arguments_.join(' ')})${detail}`);
  }
}

async function gitBytes(root, arguments_) {
  try {
    const { stdout } = await execFileAsync('git', arguments_, {
      cwd: root,
      env: gitEnvironment,
      encoding: null,
      timeout: 15_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail =
      Buffer.isBuffer(error?.stderr) && error.stderr.length > 0
        ? `: ${error.stderr.toString('utf8').trim()}`
        : '';
    throw new Error(`reviewed Git blob materialization failed (${arguments_.join(' ')})${detail}`);
  }
}
