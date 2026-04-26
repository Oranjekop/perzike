import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const outputFile = process.env.RELEASE_NOTES_FILE || process.env.OUTPUT_FILE || 'release-notes.md'
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const version = process.env.RELEASE_VERSION || process.env.PACKAGE_VERSION || pkg.version
const rawTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || version

function git(args, { optional = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim()
  } catch (error) {
    if (optional) {
      return ''
    }

    throw error
  }
}

function normalizeTag(tag) {
  return tag.replace(/^v/, '')
}

function tagExists(tag) {
  if (!tag) return false
  return git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { optional: true }) !== ''
}

function getCurrentRef() {
  if (tagExists(rawTag)) return rawTag
  if (tagExists(version)) return version
  if (tagExists(`v${version}`)) return `v${version}`
  return 'HEAD'
}

function getPreviousTag() {
  const currentTags = new Set([rawTag, version, `v${version}`].filter(Boolean))
  const tags = git(['tag', '--merged', currentRef, '--sort=-v:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^v?\d+\.\d+(?:\.\d+)?$/.test(tag))

  return tags.find((tag) => !currentTags.has(tag) && normalizeTag(tag) !== normalizeTag(version))
}

function parseChangedFiles(previousTag, currentRef) {
  const args = previousTag
    ? ['diff', '--name-status', previousTag, currentRef]
    : ['diff', '--name-status', EMPTY_TREE, currentRef]

  return git(args)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      return {
        status: parts[0],
        path: parts[parts.length - 1].replace(/\\/g, '/')
      }
    })
}

function parseCommits(previousTag, currentRef) {
  const args = ['log', '--no-merges', '--reverse', '--format=%s%x1f%b%x1e']
  if (previousTag) {
    args.push(`${previousTag}..${currentRef}`)
  } else {
    args.push(currentRef)
  }

  return git(args)
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = '', body = ''] = entry.split('\x1f')
      return `${subject}\n${body}`
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)
    })
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^(feat|fix|perf|refactor|build|ci|docs|style|test|chore)(\(.+\))?:\s*/i, '')
        .trim()
    )
    .filter((line) => line && !/^(release|update version|bump version)\b/i.test(line))
}

function matchAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path))
}

function formatPaths(files) {
  const names = [...new Set(files.map((file) => file.path))]
  const shown = names.slice(0, 3).map((name) => `\`${name}\``)
  const suffix = names.length > shown.length ? ` 等 ${names.length} 个文件` : ''
  return `（涉及 ${shown.join('、')}${suffix}）`
}

const currentRef = getCurrentRef()
const previousTag = getPreviousTag()
const changedFiles = parseChangedFiles(previousTag, currentRef)
const commits = parseCommits(previousTag, currentRef)
const bullets = []

for (const commit of commits) {
  if (/[\u4e00-\u9fa5]/.test(commit) && !bullets.includes(commit)) {
    bullets.push(commit)
  }
}

if (changedFiles.some((file) => file.path === 'changelog.md' && file.status.startsWith('D'))) {
  bullets.push('移除固定更新日志文件，改为发布时按实际改动生成中文更新说明')
}

if (
  changedFiles.some((file) => file.path === 'scripts/telegram.mjs' && file.status.startsWith('D'))
) {
  bullets.push('移除旧的 Telegram 发布通知脚本')
}

const rules = [
  {
    message: '调整 GitHub Actions 发布流程，自动生成并使用中文发布日志',
    patterns: [/^\.github\/workflows\//]
  },
  {
    message: '更新发布、更新器或通知脚本',
    patterns: [/^scripts\/(release-notes|updater)\.mjs$/]
  },
  {
    message: '改进应用自动更新、版本检测或下载校验流程',
    patterns: [/^src\/main\/resolve\/autoUpdater\.ts$/, /^src\/main\/.*update/i]
  },
  {
    message: '调整 Windows 安装包、服务安装或打包配置',
    patterns: [/^build\//, /^electron-builder\.yml$/]
  },
  {
    message: '改进内核启动、系统服务或系统代理相关逻辑',
    patterns: [/^src\/main\/service\//, /^src\/main\/core\//, /^src\/main\/sys\//]
  },
  {
    message: '优化界面交互、设置页或渲染层行为',
    patterns: [/^src\/renderer\//]
  },
  {
    message: '更新内置资源、内核文件或外部资源准备流程',
    patterns: [/^extra\//, /^scripts\/prepare\.mjs$/]
  },
  {
    message: '更新项目版本、依赖或工程配置',
    patterns: [/^package\.json$/, /^pnpm-lock\.yaml$/, /^tsconfig\./, /^electron\.vite\.config\./]
  }
]

for (const rule of rules) {
  const files = changedFiles.filter((file) => matchAny(file.path, rule.patterns))
  if (files.length > 0 && !bullets.includes(rule.message)) {
    bullets.push(`${rule.message}${formatPaths(files)}`)
  }
}

if (bullets.length === 0) {
  bullets.push(`发布 ${version}，包含常规维护和构建产物更新`)
}

const notes = [
  `## ${version}`,
  '',
  '### 更新内容',
  '',
  ...bullets.map((bullet) => `- ${bullet}`),
  ''
].join('\n')

if (existsSync(outputFile)) {
  const current = readFileSync(outputFile, 'utf-8')
  if (current === notes) {
    process.exit(0)
  }
}

writeFileSync(outputFile, notes)
