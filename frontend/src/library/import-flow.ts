/**
 * 「加入文档」的选文件流程：先过学习模式门禁，通过后才打开原生选择框。
 * 单独放在这里是为了在 Node 单测里注入假的 picker，断言被拒时选择框一次都没打开。
 */
import { admitImport } from './importer.ts'

export type PickPaths = () => Promise<string[]>

/**
 * 门禁通过时调用 pick 并返回选中的路径（已去掉空项）；没通过返回 null，不会调用 pick。
 * 用户取消（返回空数组）与门禁拒绝都不提示；pick 抛错原样抛给调用方处理。
 * 调用方仍必须在真正入队时依赖 enqueue 的第二次检查：选择框打开期间表单可能被改动。
 */
export async function chooseLibraryPaths(pick: PickPaths): Promise<string[] | null> {
  const gate = admitImport('library')
  if (!gate.ok) return null
  const paths = await pick()
  return Array.isArray(paths) ? paths.filter(Boolean) : []
}
