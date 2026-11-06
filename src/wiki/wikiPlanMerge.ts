// 薄页合并:主角很少、证据也少的叶子页不单独占一张卡。
// 从 wikiPlan.ts 拆出,好让主题组装有地方放。
import { dirOf } from '../modules/pathOrder.ts'
import {
  PLAN_FEATURE_SHARD_TOKEN_MAX,
  PLAN_TINY_PAGE_MAX_PRIMARY,
  PLAN_TINY_PAGE_TOKEN_MAX,
  memberOwnsEvidence,
  type WikiPlanFileInput,
  type WikiPlanPage
} from './wikiPlanTypes.ts'
import { tokensOf } from './wikiPlanGroups.ts'
import { BUILD_CONFIG_PATTERN } from './wikiPlanTree.ts'

/**
 * 薄页并进最亲近的大页。功能分片优先并进同功能最大分片;
 * 普通页按锚点目录的公共前缀挑亲戚,一段都不共就留下(乱塞曾把安装脚本塞进公共类型页)。
 * 公共文件页再薄也自成一页。原地修改 pages。
 */
export function mergeTinyPages(
  pages: WikiPlanPage[],
  byPath: Map<string, WikiPlanFileInput>,
  featurePageIds: Set<string>,
  hubPageIds: Set<string>
): void {
  const pageTokens = (page: WikiPlanPage): number =>
    page.members
      .filter((member) => memberOwnsEvidence(member.role))
      .reduce(
        (sum, member) => sum + (byPath.get(member.path) ? tokensOf(byPath.get(member.path)!) : 0),
        0
      )
  const primaryCount = (page: WikiPlanPage): number =>
    page.members.filter((member) => member.role === 'primary').length
  const commonPrefixSegs = (a: string, b: string): number => {
    const as = a === '' ? [] : a.split('/')
    const bs = b === '' ? [] : b.split('/')
    let n = 0
    while (n < as.length && n < bs.length && as[n] === bs[n]) n++
    return n
  }
  const leafNow = pages.filter((page) => page.kind === 'leaf')
  for (const page of leafNow) {
    if (hubPageIds.has(page.id)) continue
    const isFeatureShard = featurePageIds.has(page.id)
    const tinyLimit = isFeatureShard ? PLAN_FEATURE_SHARD_TOKEN_MAX : PLAN_TINY_PAGE_TOKEN_MAX
    if (primaryCount(page) > PLAN_TINY_PAGE_MAX_PRIMARY || pageTokens(page) >= tinyLimit) continue
    let target: WikiPlanPage | undefined
    if (isFeatureShard && page.topicDir) {
      target = pages
        .filter(
          (other) => other.kind === 'leaf' && other !== page && other.topicDir === page.topicDir
        )
        .sort((a, b) => primaryCount(b) - primaryCount(a))[0]
    } else {
      target = pages
        .filter((other) => other.kind === 'leaf' && other !== page && !hubPageIds.has(other.id))
        .map((other) => ({
          page: other,
          shared: commonPrefixSegs(other.anchorDir, page.anchorDir)
        }))
        .filter((candidate) => candidate.shared >= 1)
        .sort((a, b) => b.shared - a.shared || primaryCount(b.page) - primaryCount(a.page))[0]?.page
    }
    if (!target) {
      // 构建类薄页归入根主题「构建与部署」,不自成叶子页
      const buildRoot = pages.find((other) => other.kind === 'root' && other.title === '构建与部署')
      const primaries = page.members
        .filter((member) => member.role === 'primary')
        .map((member) => member.path)
      const allBuildish =
        primaries.length > 0 &&
        primaries.every(
          (path) =>
            dirOf(path) === 'build' || BUILD_CONFIG_PATTERN.test(path) || /installer/i.test(path)
        )
      if (buildRoot && allBuildish) target = buildRoot
    }
    if (!target) continue
    for (const member of page.members) {
      if (target.members.some((existing) => existing.path === member.path)) continue
      target.members.push({
        path: member.path,
        role: member.role === 'attached' || member.role === 'reference' ? member.role : 'supporting'
      })
    }
    page.members = []
    pages.splice(pages.indexOf(page), 1)
  }
}
